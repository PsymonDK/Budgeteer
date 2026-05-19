import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertHouseholdAccess } from '../lib/ownership'
import { BASE_CURRENCY } from '../lib/currency'
import { buildReceiptSummaryDateFilter, summarizeReceiptConsumption } from '../lib/receiptConsumption'
import { buildReceiptMappingExportKit, confirmReceiptMappingImport, previewReceiptMappingImport } from '../lib/receiptMappingImport'
import { correctReceiptOcrText, learnReceiptMappings, loadReceiptClassifierConfig, normalizeReceiptLabel, parseReceipt } from '../lib/receiptParser'
import { extractReceiptOcrText } from '../lib/receiptOcr'
import { toNum } from '../lib/decimal'

const ConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

const ParseReceiptSchema = z.object({
  rawText: z.string().max(120_000).optional(),
  accountId: z.string().nullable().optional(),
}).refine(
  (data) => Boolean(data.rawText?.trim()),
  { message: 'rawText is required for JSON receipt parsing' },
)

const ALLOWED_RECEIPT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
const SAFE_STORAGE_SEGMENT = /^[a-z0-9_-]+$/i
type ReceiptFileExtension = 'pdf' | 'png' | 'jpg'

const UpdateReceiptSchema = z.object({
  merchantName: z.string().max(200).nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  totalAmount: z.number().nonnegative().nullable().optional(),
  taxAmount: z.number().nonnegative().nullable().optional(),
  feeAmount: z.number().nonnegative().nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  accountId: z.string().nullable().optional(),
})

const UpdateLineItemSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  originalText: z.string().min(1).max(500).optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  amount: z.number().nonnegative().optional(),
  categoryId: z.string().nullable().optional(),
  subcategoryId: z.string().nullable().optional(),
  confidence: ConfidenceSchema.optional(),
  isIgnored: z.boolean().optional(),
})

const CreateLineItemSchema = z.object({
  label: z.string().min(1).max(200),
  originalText: z.string().min(1).max(500).optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  amount: z.number().nonnegative(),
  categoryId: z.string().nullable().optional(),
  subcategoryId: z.string().nullable().optional(),
  confidence: ConfidenceSchema.optional(),
  isIgnored: z.boolean().optional(),
})

const ReceiptSummaryQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2500).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  period: z.enum([
    'allTime',
    'currentMonth',
    'previousMonth',
    'currentQuarter',
    'previousQuarter',
    'currentYear',
    'previousYear',
    'last12Months',
    'custom',
  ]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((data, ctx) => {
  if (data.period === 'custom' && (!data.startDate || !data.endDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startDate and endDate are required for custom period' })
  }
})

const ReceiptMappingImportSchema = z.object({
  csvText: z.string().min(1).max(1_000_000),
})

const receiptInclude = {
  uploadedBy: { select: { id: true, name: true } },
  account: { select: { id: true, name: true, type: true } },
  lineItems: {
    include: {
      category: { select: { id: true, name: true, icon: true } },
      subcategory: { select: { id: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const

export async function receiptRoutes(fastify: FastifyInstance) {
  // POST /households/:id/receipts/parse
  fastify.post('/households/:id/receipts/parse', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const body = ParseReceiptSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })
    }

    if (body.data.accountId) {
      const accountError = await validateAccountAccess(body.data.accountId, householdId, userId)
      if (accountError) return reply.status(400).send({ error: accountError })
    }

    try {
      const fallbackCurrency = await getHouseholdReceiptCurrency(householdId)
      const classifierConfig = await loadReceiptClassifierConfig(householdId)
      const rawText = body.data.rawText?.trim() ?? ''
      const correctedRawText = correctReceiptOcrText(rawText, classifierConfig)
      const parsed = await parseReceipt({
        ...body.data,
        rawText: correctedRawText || rawText,
        displayRawText: rawText,
        fallbackCurrency,
      }, householdId)
      const receiptCurrency = await resolveReceiptCurrency(parsed.currencyCode, fallbackCurrency)
      const receipt = await prisma.receipt.create({
        data: {
          householdId,
          uploadedByUserId: userId,
          accountId: body.data.accountId ?? null,
          merchantName: parsed.merchantName ?? null,
          purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : null,
          totalAmount: sumParsedLineItems(parsed.lineItems),
          taxAmount: parsed.taxAmount != null ? new Decimal(parsed.taxAmount) : null,
          feeAmount: parsed.feeAmount != null ? new Decimal(parsed.feeAmount) : null,
          currencyCode: receiptCurrency,
          rawText: body.data.rawText ?? null,
          confidence: parsed.confidence,
          status: 'DRAFT',
          notes: parsed.notes,
          lineItems: {
            create: parsed.lineItems.map((item, index) => ({
              originalText: item.originalText,
              label: item.label,
              normalizedLabel: item.normalizedLabel,
              quantity: item.quantity != null ? new Decimal(item.quantity) : null,
              amount: new Decimal(item.amount),
              currencyCode: receiptCurrency,
              categoryId: item.categoryId ?? null,
              subcategoryId: item.subcategoryId ?? null,
              confidence: item.confidence,
              sortOrder: index,
            })),
          },
        },
        include: receiptInclude,
      })

      return reply.status(201).send(serializeReceipt(receipt))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Receipt parsing failed'
      return reply.status(422).send({ error: message, code: 'PARSE_ERROR' })
    }
  })

  // POST /households/:id/receipts/upload
  fastify.post('/households/:id/receipts/upload', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })
    if (!ALLOWED_RECEIPT_MIME_TYPES.has(data.mimetype)) {
      return reply.status(400).send({ error: 'Only PNG, JPEG, and PDF receipts are supported' })
    }
    const accountId = getMultipartFieldValue(data.fields, 'accountId')
    if (accountId) {
      const accountError = await validateAccountAccess(accountId, householdId, userId)
      if (accountError) return reply.status(400).send({ error: accountError })
    }

    const ext = data.mimetype === 'application/pdf' ? 'pdf' : data.mimetype === 'image/png' ? 'png' : 'jpg'
    const buffer = await data.toBuffer()
    const fallbackCurrency = await getHouseholdReceiptCurrency(householdId)
    const receipt = await prisma.receipt.create({
      data: {
        householdId,
        uploadedByUserId: userId,
        accountId: accountId || null,
        sourceMimeType: data.mimetype,
        sourceFileName: data.filename,
        currencyCode: fallbackCurrency,
        status: 'DRAFT',
        confidence: 'LOW',
        notes: [],
      },
      include: receiptInclude,
    })

    const { receiptDir, relativePath, storagePath } = buildReceiptStoragePath(receipt.id, ext)
    fs.mkdirSync(receiptDir, { recursive: true })

    let fileSize = 0
    try {
      fs.writeFileSync(storagePath, buffer)
      const stat = fs.statSync(storagePath)
      fileSize = stat.size
    } catch (err) {
      try {
        if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath)
      } catch {}
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { status: 'FAILED', notes: [err instanceof Error ? err.message : 'Receipt upload failed'] },
      })
      const message = err instanceof Error ? err.message : 'Receipt upload failed'
      return reply.status(422).send({ error: message, code: 'PARSE_ERROR' })
    }

    const ocr = await extractReceiptOcrText({
      filePath: storagePath,
      mimeType: data.mimetype as 'application/pdf' | 'image/png' | 'image/jpeg',
    })

    let parsed
    try {
      const classifierConfig = await loadReceiptClassifierConfig(householdId)
      const correctedRawText = ocr.rawText ? correctReceiptOcrText(ocr.rawText, classifierConfig) : ''
      parsed = await parseReceipt({
        rawText: correctedRawText || ocr.rawText || undefined,
        displayRawText: ocr.rawText || undefined,
        fileName: data.filename,
        mimeType: data.mimetype as 'application/pdf' | 'image/png' | 'image/jpeg',
        fileBase64: data.mimetype.startsWith('image/') ? buffer.toString('base64') : undefined,
        fallbackCurrency,
      }, householdId)
      parsed.notes = [...ocr.notes, ...parsed.notes]
    } catch (err) {
      parsed = {
        merchantName: data.filename.replace(/\.[^.]+$/, ''),
        purchaseDate: null,
        totalAmount: null,
        taxAmount: null,
        feeAmount: null,
        currencyCode: fallbackCurrency,
        confidence: 'LOW' as const,
        notes: [...ocr.notes, err instanceof Error ? err.message : 'Receipt parsing failed. Review the stored receipt manually.'],
        lineItems: [],
      }
    }

    const receiptCurrency = await resolveReceiptCurrency(parsed.currencyCode, fallbackCurrency)
    const updated = await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        merchantName: parsed.merchantName ?? null,
        purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : null,
        totalAmount: sumParsedLineItems(parsed.lineItems),
        taxAmount: parsed.taxAmount != null ? new Decimal(parsed.taxAmount) : null,
        feeAmount: parsed.feeAmount != null ? new Decimal(parsed.feeAmount) : null,
        currencyCode: receiptCurrency,
        sourceStoragePath: relativePath,
        sourceFileSize: fileSize,
        rawText: ocr.rawText || null,
        confidence: parsed.confidence,
        notes: parsed.notes,
        lineItems: {
          create: parsed.lineItems.map((item, index) => ({
            originalText: item.originalText,
            label: item.label,
            normalizedLabel: item.normalizedLabel,
            quantity: item.quantity != null ? new Decimal(item.quantity) : null,
            amount: new Decimal(item.amount),
            currencyCode: receiptCurrency,
            categoryId: item.categoryId ?? null,
            subcategoryId: item.subcategoryId ?? null,
            confidence: item.confidence,
            sortOrder: index,
          })),
        },
      },
      include: receiptInclude,
    })
    return reply.status(201).send(serializeReceipt(updated))
  })

  // GET /households/:id/receipts
  fastify.get('/households/:id/receipts', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const receipts = await prisma.receipt.findMany({
      where: { householdId, deletedAt: null },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, type: true } },
        lineItems: {
          include: {
            category: { select: { id: true, name: true, icon: true } },
            subcategory: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    })

    return reply.send(receipts.map(serializeReceiptSummary))
  })

  // GET /households/:id/receipts/summary
  fastify.get('/households/:id/receipts/summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const query = ReceiptSummaryQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: query.error.flatten() })

    let periodInfo
    try {
      periodInfo = buildReceiptSummaryDateFilter(query.data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid query parameters'
      return reply.status(400).send({ error: message })
    }

    const lineItems = await prisma.receiptLineItem.findMany({
      where: {
        isIgnored: false,
        receipt: {
          householdId,
          status: 'CONFIRMED',
          deletedAt: null,
          ...(periodInfo.filter ? { purchaseDate: periodInfo.filter } : {}),
        },
      },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        subcategory: { select: { id: true, name: true } },
        receipt: { select: { purchaseDate: true, currencyCode: true } },
      },
    })

    return reply.send(await summarizeReceiptConsumption(lineItems, periodInfo))
  })

  // GET /households/:id/receipt-mappings/export-kit
  fastify.get('/households/:id/receipt-mappings/export-kit', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    return reply.send(await buildReceiptMappingExportKit(householdId))
  })

  // POST /households/:id/receipt-mappings/import-preview
  fastify.post('/households/:id/receipt-mappings/import-preview', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const body = ReceiptMappingImportSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    try {
      return reply.send(await previewReceiptMappingImport(householdId, body.data.csvText))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview receipt mappings'
      return reply.status(400).send({ error: message })
    }
  })

  // POST /households/:id/receipt-mappings/import-confirm
  fastify.post('/households/:id/receipt-mappings/import-confirm', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const body = ReceiptMappingImportSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    try {
      return reply.send(await confirmReceiptMappingImport(householdId, body.data.csvText))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import receipt mappings'
      return reply.status(400).send({ error: message })
    }
  })

  // GET /households/:id/receipts/:receiptId
  fastify.get('/households/:id/receipts/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return
    return reply.send(serializeReceipt(receipt))
  })

  // GET /households/:id/receipts/:receiptId/file
  fastify.get('/households/:id/receipts/:receiptId/file', {
    preHandler: authenticate,
    config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return
    if (!receipt.sourceStoragePath || !receipt.sourceMimeType) {
      return reply.status(404).send({ error: 'Receipt file not found' })
    }

    const ext = getReceiptFileExtension(receipt.sourceMimeType)
    const filePath = ext
      ? buildReceiptFileCandidates(receipt.id, receipt.householdId, ext).find((candidate) => fs.existsSync(candidate))
      : null
    if (!filePath) {
      return reply.status(404).send({ error: 'Receipt file not found' })
    }

    return reply.type(receipt.sourceMimeType).send(fs.createReadStream(filePath))
  })

  // PUT /households/:id/receipts/:receiptId
  fastify.put('/households/:id/receipts/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return

    const body = UpdateReceiptSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    if (body.data.accountId) {
      const { id: householdId } = request.params as { id: string }
      const accountError = await validateAccountAccess(body.data.accountId, householdId, request.user.sub)
      if (accountError) return reply.status(400).send({ error: accountError })
    }

    let nextCurrencyCode: string | undefined
    if (body.data.currencyCode !== undefined) {
      nextCurrencyCode = body.data.currencyCode.toUpperCase()
      if (!await isEnabledReceiptCurrency(nextCurrencyCode)) {
        return reply.status(400).send({ error: 'Currency is not enabled' })
      }
    }

    await syncReceiptTotalFromLines(receipt.id)
    const updated = await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        ...(body.data.merchantName !== undefined && { merchantName: body.data.merchantName }),
        ...(body.data.purchaseDate !== undefined && { purchaseDate: body.data.purchaseDate ? new Date(body.data.purchaseDate) : null }),
        ...(body.data.taxAmount !== undefined && { taxAmount: body.data.taxAmount != null ? new Decimal(body.data.taxAmount) : null }),
        ...(body.data.feeAmount !== undefined && { feeAmount: body.data.feeAmount != null ? new Decimal(body.data.feeAmount) : null }),
        ...(nextCurrencyCode !== undefined && { currencyCode: nextCurrencyCode }),
        ...(body.data.accountId !== undefined && { accountId: body.data.accountId }),
      },
      include: receiptInclude,
    })

    return reply.send(serializeReceipt(updated))
  })

  // PUT /households/:id/receipts/:receiptId/line-items/:lineItemId
  fastify.put('/households/:id/receipts/:receiptId/line-items/:lineItemId', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return

    const { lineItemId } = request.params as { lineItemId: string }
    const body = UpdateLineItemSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const existing = await prisma.receiptLineItem.findFirst({ where: { id: lineItemId, receiptId: receipt.id } })
    if (!existing) return reply.status(404).send({ error: 'Receipt line item not found' })

    if (body.data.categoryId) {
      const category = await validateExpenseCategory(body.data.categoryId, receipt.householdId)
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }
    if (body.data.subcategoryId) {
      const subcategory = await validateReceiptSubcategory(body.data.subcategoryId, body.data.categoryId ?? existing.categoryId, receipt.householdId)
      if (!subcategory) return reply.status(400).send({ error: 'Subcategory not found' })
    }

    const label = body.data.label ?? existing.label
    const nextCategoryId = body.data.categoryId !== undefined ? body.data.categoryId : existing.categoryId
    const updated = await prisma.receiptLineItem.update({
      where: { id: lineItemId },
      data: {
        ...(body.data.originalText !== undefined && { originalText: body.data.originalText }),
        ...(body.data.label !== undefined && { label, normalizedLabel: normalizeReceiptLabel(label, await loadReceiptClassifierConfig(receipt.householdId)) }),
        ...(body.data.quantity !== undefined && { quantity: body.data.quantity != null ? new Decimal(body.data.quantity) : null }),
        ...(body.data.amount !== undefined && { amount: new Decimal(body.data.amount) }),
        ...(body.data.categoryId !== undefined && { categoryId: body.data.categoryId }),
        ...(body.data.categoryId !== undefined && body.data.subcategoryId === undefined && { subcategoryId: null }),
        ...(body.data.subcategoryId !== undefined && {
          subcategoryId: body.data.subcategoryId,
          ...(body.data.subcategoryId && !nextCategoryId ? { categoryId: nextCategoryId } : {}),
        }),
        ...(body.data.confidence !== undefined && { confidence: body.data.confidence }),
        ...(body.data.isIgnored !== undefined && { isIgnored: body.data.isIgnored }),
      },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        subcategory: { select: { id: true, name: true } },
      },
    })

    await syncReceiptTotalFromLines(receipt.id)
    return reply.send(serializeLineItem(updated))
  })

  // POST /households/:id/receipts/:receiptId/line-items
  fastify.post('/households/:id/receipts/:receiptId/line-items', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return

    const body = CreateLineItemSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    if (body.data.categoryId) {
      const category = await validateExpenseCategory(body.data.categoryId, receipt.householdId)
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }
    if (body.data.subcategoryId) {
      const subcategory = await validateReceiptSubcategory(body.data.subcategoryId, body.data.categoryId ?? null, receipt.householdId)
      if (!subcategory) return reply.status(400).send({ error: 'Subcategory not found' })
    }

    const sortOrder = await nextReceiptLineSortOrder(receipt.id)
    const lineItem = await prisma.receiptLineItem.create({
      data: {
        receiptId: receipt.id,
        originalText: body.data.originalText?.trim() || body.data.label.trim(),
        label: body.data.label.trim(),
        normalizedLabel: normalizeReceiptLabel(body.data.label, await loadReceiptClassifierConfig(receipt.householdId)),
        quantity: body.data.quantity != null ? new Decimal(body.data.quantity) : null,
        amount: new Decimal(body.data.amount),
        currencyCode: receipt.currencyCode,
        categoryId: body.data.categoryId ?? null,
        subcategoryId: body.data.subcategoryId ?? null,
        confidence: body.data.confidence ?? 'HIGH',
        isIgnored: body.data.isIgnored ?? false,
        sortOrder,
      },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        subcategory: { select: { id: true, name: true } },
      },
    })

    await syncReceiptTotalFromLines(receipt.id)
    return reply.status(201).send(serializeLineItem(lineItem))
  })

  // POST /households/:id/receipts/:receiptId/confirm
  fastify.post('/households/:id/receipts/:receiptId/confirm', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return

    await syncReceiptTotalFromLines(receipt.id)
    const confirmed = await prisma.receipt.update({
      where: { id: receipt.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      include: receiptInclude,
    })

    await learnReceiptMappings({
      householdId: confirmed.householdId,
      merchantName: confirmed.merchantName,
      items: confirmed.lineItems.map((item) => ({
        normalizedLabel: item.normalizedLabel,
        originalText: item.originalText,
        label: item.label,
        categoryId: item.categoryId,
        subcategoryId: item.subcategoryId,
        isIgnored: item.isIgnored,
      })),
    })

    return reply.send(serializeReceipt(confirmed))
  })

  // DELETE /households/:id/receipts/:receiptId
  fastify.delete('/households/:id/receipts/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return
    await prisma.receipt.update({ where: { id: receipt.id }, data: { deletedAt: new Date() } })
    return reply.status(204).send()
  })
}

async function loadReceiptForHousehold(request: any, reply: any) {
  const { id: householdId, receiptId } = request.params as { id: string; receiptId: string }
  const { sub: userId, role } = request.user
  if (!await assertHouseholdAccess(householdId, userId, role, reply)) return null

  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, householdId, deletedAt: null },
    include: receiptInclude,
  })
  if (!receipt) {
    reply.status(404).send({ error: 'Receipt not found' })
    return null
  }
  return receipt
}

async function validateAccountAccess(accountId: string, householdId: string, userId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account || !account.isActive) return 'Account not found'
  if (account.householdId === householdId || account.ownedByUserId === userId) return null
  return 'Account not accessible'
}

function getReceiptFileExtension(mimeType: string): ReceiptFileExtension | null {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  return null
}

function buildReceiptStoragePath(receiptId: string, ext: ReceiptFileExtension) {
  const safeReceiptId = assertSafeStorageSegment(receiptId, 'receiptId')
  const uploadRoot = path.resolve(UPLOAD_DIR)
  const relativePath = path.join('receipts', `${safeReceiptId}.${ext}`)
  const storagePath = path.join(uploadRoot, relativePath)
  return {
    receiptDir: path.dirname(storagePath),
    relativePath,
    storagePath,
  }
}

function buildReceiptFileCandidates(receiptId: string, householdId: string, ext: ReceiptFileExtension): string[] {
  const currentPath = buildReceiptStoragePath(receiptId, ext).storagePath
  const safeHouseholdId = assertSafeStorageSegment(householdId, 'householdId')
  const safeReceiptId = assertSafeStorageSegment(receiptId, 'receiptId')
  const legacyPath = path.join(path.resolve(UPLOAD_DIR), 'receipts', safeHouseholdId, `${safeReceiptId}.${ext}`)
  return currentPath === legacyPath ? [currentPath] : [currentPath, legacyPath]
}

function assertSafeStorageSegment(value: string, label: string): string {
  if (!SAFE_STORAGE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

async function getHouseholdReceiptCurrency(_householdId: string): Promise<string> {
  return BASE_CURRENCY
}

async function resolveReceiptCurrency(currencyCode: string | null | undefined, fallbackCurrency: string): Promise<string> {
  const code = currencyCode?.toUpperCase() || fallbackCurrency
  if (await isEnabledReceiptCurrency(code)) return code
  return fallbackCurrency
}

async function isEnabledReceiptCurrency(currencyCode: string): Promise<boolean> {
  if (currencyCode === BASE_CURRENCY) return true
  const currency = await prisma.currency.findFirst({
    where: { code: currencyCode, isEnabled: true },
    select: { code: true },
  })
  return Boolean(currency)
}

async function validateExpenseCategory(categoryId: string, householdId: string) {
  return prisma.category.findFirst({
    where: {
      id: categoryId,
      categoryType: 'EXPENSE',
      isActive: true,
      OR: [{ isSystemWide: true }, { householdId }],
    },
  })
}

async function validateReceiptSubcategory(subcategoryId: string, categoryId: string | null, householdId: string) {
  if (!categoryId) return null
  return prisma.receiptSubcategory.findFirst({
    where: {
      id: subcategoryId,
      categoryId,
      isActive: true,
      OR: [{ isSystemWide: true }, { householdId }],
    },
  })
}

async function nextReceiptLineSortOrder(receiptId: string): Promise<number> {
  const latest = await prisma.receiptLineItem.findFirst({
    where: { receiptId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  return (latest?.sortOrder ?? -1) + 1
}

async function syncReceiptTotalFromLines(receiptId: string) {
  const lines = await prisma.receiptLineItem.findMany({
    where: { receiptId, isIgnored: false },
    select: { amount: true },
  })
  const total = lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
  return prisma.receipt.update({ where: { id: receiptId }, data: { totalAmount: total } })
}

function sumParsedLineItems(lineItems: Array<{ amount: number; confidence?: string }>): Decimal {
  return lineItems.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))
}

function serializeReceipt(receipt: any) {
  const { sourceStoragePath: _sourceStoragePath, ...safeReceipt } = receipt
  return {
    ...safeReceipt,
    purchaseDate: receipt.purchaseDate ? receipt.purchaseDate.toISOString().slice(0, 10) : null,
    totalAmount: receipt.totalAmount?.toString() ?? null,
    taxAmount: receipt.taxAmount?.toString() ?? null,
    feeAmount: receipt.feeAmount?.toString() ?? null,
    hasSourceFile: Boolean(receipt.sourceStoragePath),
    lineItems: receipt.lineItems.map(serializeLineItem),
  }
}

function serializeReceiptSummary(receipt: any) {
  const items = receipt.lineItems.filter((item: any) => !item.isIgnored)
  const itemTotal = items.reduce((sum: number, item: any) => sum + toNum(item.amount), 0)
  const lowConfidenceCount = receipt.lineItems.filter((item: any) => item.confidence === 'LOW' || !item.categoryId).length
  return {
    id: receipt.id,
    merchantName: receipt.merchantName,
    purchaseDate: receipt.purchaseDate ? receipt.purchaseDate.toISOString().slice(0, 10) : null,
    totalAmount: receipt.totalAmount?.toString() ?? null,
    currencyCode: receipt.currencyCode,
    status: receipt.status,
    confidence: receipt.confidence,
    uploadedBy: receipt.uploadedBy,
    account: receipt.account,
    hasSourceFile: Boolean(receipt.sourceStoragePath),
    itemCount: receipt.lineItems.length,
    itemTotal: itemTotal.toFixed(2),
    lowConfidenceCount,
    createdAt: receipt.createdAt,
  }
}

function serializeLineItem(item: any) {
  return {
    ...item,
    amount: item.amount.toString(),
    quantity: item.quantity?.toString() ?? null,
  }
}

function getMultipartFieldValue(fields: Record<string, unknown> | undefined, key: string): string | null {
  const field = fields?.[key] as { value?: unknown } | undefined
  return typeof field?.value === 'string' && field.value.trim() ? field.value.trim() : null
}
