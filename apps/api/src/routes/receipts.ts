import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertHouseholdAccess } from '../lib/ownership'
import { BASE_CURRENCY } from '../lib/currency'
import { learnReceiptMappings, normalizeReceiptLabel, parseReceipt } from '../lib/receiptParser'
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
      const parsed = await parseReceipt(body.data, householdId)
      const receipt = await prisma.receipt.create({
        data: {
          householdId,
          uploadedByUserId: userId,
          accountId: body.data.accountId ?? null,
          merchantName: parsed.merchantName ?? null,
          purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : null,
          totalAmount: parsed.totalAmount != null ? new Decimal(parsed.totalAmount) : null,
          taxAmount: parsed.taxAmount != null ? new Decimal(parsed.taxAmount) : null,
          feeAmount: parsed.feeAmount != null ? new Decimal(parsed.feeAmount) : null,
          currencyCode: parsed.currencyCode || BASE_CURRENCY,
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
              currencyCode: parsed.currencyCode || BASE_CURRENCY,
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
  fastify.post('/households/:id/receipts/upload', { preHandler: authenticate }, async (request, reply) => {
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
    const receipt = await prisma.receipt.create({
      data: {
        householdId,
        uploadedByUserId: userId,
        accountId: accountId || null,
        sourceMimeType: data.mimetype,
        sourceFileName: data.filename,
        currencyCode: BASE_CURRENCY,
        status: 'DRAFT',
        confidence: 'LOW',
        notes: [],
      },
      include: receiptInclude,
    })

    const receiptDir = path.resolve(UPLOAD_DIR, 'receipts', householdId)
    fs.mkdirSync(receiptDir, { recursive: true })
    const relativePath = path.join('receipts', householdId, `${receipt.id}.${ext}`)
    const storagePath = path.resolve(UPLOAD_DIR, relativePath)

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
      parsed = await parseReceipt({
        rawText: ocr.rawText || undefined,
        fileName: data.filename,
        mimeType: data.mimetype as 'application/pdf' | 'image/png' | 'image/jpeg',
        fileBase64: data.mimetype.startsWith('image/') ? buffer.toString('base64') : undefined,
      }, householdId)
      parsed.notes = [...ocr.notes, ...parsed.notes]
    } catch (err) {
      parsed = {
        merchantName: data.filename.replace(/\.[^.]+$/, ''),
        purchaseDate: null,
        totalAmount: null,
        taxAmount: null,
        feeAmount: null,
        currencyCode: BASE_CURRENCY,
        confidence: 'LOW' as const,
        notes: [...ocr.notes, err instanceof Error ? err.message : 'Receipt parsing failed. Review the stored receipt manually.'],
        lineItems: [],
      }
    }

    const updated = await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        merchantName: parsed.merchantName ?? null,
        purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : null,
        totalAmount: parsed.totalAmount != null ? new Decimal(parsed.totalAmount) : null,
        taxAmount: parsed.taxAmount != null ? new Decimal(parsed.taxAmount) : null,
        feeAmount: parsed.feeAmount != null ? new Decimal(parsed.feeAmount) : null,
        currencyCode: parsed.currencyCode || BASE_CURRENCY,
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
            currencyCode: parsed.currencyCode || BASE_CURRENCY,
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

    const query = z.object({
      year: z.coerce.number().int().min(1900).max(2500).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    }).safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: query.error.flatten() })

    const dateFilter = buildDateFilter(query.data.year, query.data.month)
    const lineItems = await prisma.receiptLineItem.findMany({
      where: {
        isIgnored: false,
        receipt: {
          householdId,
          status: 'CONFIRMED',
          deletedAt: null,
          ...(dateFilter ? { purchaseDate: dateFilter } : {}),
        },
      },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        subcategory: { select: { id: true, name: true } },
        receipt: { select: { purchaseDate: true, currencyCode: true } },
      },
    })

    const byCategory = new Map<string, { categoryId: string | null; categoryName: string; categoryIcon: string | null; total: number; itemCount: number }>()
    const bySubcategory = new Map<string, { categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: number; itemCount: number }>()
    const byMonth = new Map<string, number>()
    let total = 0

    for (const item of lineItems) {
      const amount = toNum(item.amount)
      total += amount
      const key = item.categoryId ?? '__uncategorized__'
      const existing = byCategory.get(key) ?? {
        categoryId: item.categoryId,
        categoryName: item.category?.name ?? 'Uncategorized',
        categoryIcon: item.category?.icon ?? null,
        total: 0,
        itemCount: 0,
      }
      existing.total += amount
      existing.itemCount += 1
      byCategory.set(key, existing)

      const subKey = item.subcategoryId ?? `${key}::__uncategorized__`
      const existingSub = bySubcategory.get(subKey) ?? {
        categoryId: item.categoryId,
        categoryName: item.category?.name ?? 'Uncategorized',
        subcategoryId: item.subcategoryId,
        subcategoryName: item.subcategory?.name ?? 'Uncategorized',
        total: 0,
        itemCount: 0,
      }
      existingSub.total += amount
      existingSub.itemCount += 1
      bySubcategory.set(subKey, existingSub)

      if (item.receipt.purchaseDate) {
        const monthKey = item.receipt.purchaseDate.toISOString().slice(0, 7)
        byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount)
      }
    }

    return reply.send({
      total: total.toFixed(2),
      itemCount: lineItems.length,
      byCategory: [...byCategory.values()]
        .sort((a, b) => b.total - a.total)
        .map((row) => ({ ...row, total: row.total.toFixed(2) })),
      bySubcategory: [...bySubcategory.values()]
        .sort((a, b) => b.total - a.total)
        .map((row) => ({ ...row, total: row.total.toFixed(2) })),
      byMonth: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, total: amount.toFixed(2) })),
    })
  })

  // GET /households/:id/receipts/:receiptId
  fastify.get('/households/:id/receipts/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return
    return reply.send(serializeReceipt(receipt))
  })

  // GET /households/:id/receipts/:receiptId/file
  fastify.get('/households/:id/receipts/:receiptId/file', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return
    if (!receipt.sourceStoragePath || !receipt.sourceMimeType) {
      return reply.status(404).send({ error: 'Receipt file not found' })
    }

    const uploadRoot = path.resolve(UPLOAD_DIR)
    const filePath = path.resolve(uploadRoot, receipt.sourceStoragePath)
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`) || !fs.existsSync(filePath)) {
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

    const updated = await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        ...(body.data.merchantName !== undefined && { merchantName: body.data.merchantName }),
        ...(body.data.purchaseDate !== undefined && { purchaseDate: body.data.purchaseDate ? new Date(body.data.purchaseDate) : null }),
        ...(body.data.totalAmount !== undefined && { totalAmount: body.data.totalAmount != null ? new Decimal(body.data.totalAmount) : null }),
        ...(body.data.taxAmount !== undefined && { taxAmount: body.data.taxAmount != null ? new Decimal(body.data.taxAmount) : null }),
        ...(body.data.feeAmount !== undefined && { feeAmount: body.data.feeAmount != null ? new Decimal(body.data.feeAmount) : null }),
        ...(body.data.currencyCode !== undefined && { currencyCode: body.data.currencyCode.toUpperCase() }),
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
        ...(body.data.label !== undefined && { label, normalizedLabel: normalizeReceiptLabel(label) }),
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

    return reply.send(serializeLineItem(updated))
  })

  // POST /households/:id/receipts/:receiptId/confirm
  fastify.post('/households/:id/receipts/:receiptId/confirm', { preHandler: authenticate }, async (request, reply) => {
    const receipt = await loadReceiptForHousehold(request, reply)
    if (!receipt) return

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

function buildDateFilter(year?: number, month?: number) {
  if (!year) return null
  const start = new Date(Date.UTC(year, month ? month - 1 : 0, 1))
  const end = month ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year + 1, 0, 1))
  return { gte: start, lt: end }
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
