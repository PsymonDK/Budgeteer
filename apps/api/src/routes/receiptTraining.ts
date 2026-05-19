import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../plugins/authenticate'
import { loadReceiptClassifierConfig, normalizeReceiptLabel } from '../lib/receiptParser'

const ScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('system') }),
  z.object({ scope: z.literal('household'), householdId: z.string().min(1) }),
])

const TermTypeSchema = z.enum(['NOISE_TOKEN', 'LOW_VALUE_WORD', 'OCR_ALIAS'])

const CreateTermSchema = ScopeSchema.and(z.object({
  termType: TermTypeSchema,
  term: z.string().min(1).max(120),
  isActive: z.boolean().optional(),
  source: z.string().max(40).optional(),
}))

const UpdateTermSchema = z.object({
  termType: TermTypeSchema.optional(),
  term: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  source: z.string().max(40).optional(),
})

const CreateSubcategorySchema = ScopeSchema.and(z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(100),
  isActive: z.boolean().optional(),
}))

const UpdateSubcategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
})

const CreateMappingSchema = z.object({
  householdId: z.string().min(1),
  merchantKey: z.string().max(200).optional(),
  normalizedLabel: z.string().min(1).max(200),
  categoryId: z.string().min(1),
  subcategoryId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const UpdateMappingSchema = z.object({
  merchantKey: z.string().max(200).optional(),
  normalizedLabel: z.string().min(1).max(200).optional(),
  categoryId: z.string().min(1).optional(),
  subcategoryId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export async function receiptTrainingRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/receipt-training', { preHandler: requireAdmin }, async (_request, reply) => {
    const [households, categories, subcategories, mappings, terms] = await Promise.all([
      prisma.household.findMany({
        select: { id: true, name: true, isActive: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      prisma.category.findMany({
        where: { categoryType: 'EXPENSE' },
        select: { id: true, name: true, icon: true, isSystemWide: true, isActive: true, householdId: true },
        orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
      }),
      prisma.receiptSubcategory.findMany({
        include: {
          category: { select: { id: true, name: true } },
          household: { select: { id: true, name: true } },
          _count: { select: { lineItems: true, mappings: true } },
        },
        orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
      }),
      prisma.receiptCategoryMapping.findMany({
        include: {
          household: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          subcategory: { select: { id: true, name: true } },
        },
        orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 2000,
      }),
      prisma.receiptClassifierTerm.findMany({
        include: { household: { select: { id: true, name: true } } },
        orderBy: [{ scopeKey: 'asc' }, { termType: 'asc' }, { term: 'asc' }],
      }),
    ])

    return reply.send({
      households,
      categories,
      subcategories: subcategories.map(serializeSubcategory),
      mappings: mappings.map(serializeMapping),
      terms: terms.map(serializeTerm),
    })
  })

  fastify.post('/admin/receipt-training/terms', { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateTermSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const scoped = resolveScope(body.data)
    const term = normalizeTrainingTerm(body.data.termType, body.data.term)
    if (!term) return reply.status(400).send({ error: 'Invalid classifier term' })

    const created = await prisma.receiptClassifierTerm.upsert({
      where: { scopeKey_termType_term: { scopeKey: scoped.scopeKey, termType: body.data.termType, term } },
      create: {
        scopeKey: scoped.scopeKey,
        householdId: scoped.householdId,
        termType: body.data.termType,
        term,
        isActive: body.data.isActive ?? true,
        source: body.data.source?.trim() || 'ADMIN',
      },
      update: {
        isActive: body.data.isActive ?? true,
        source: body.data.source?.trim() || 'ADMIN',
      },
      include: { household: { select: { id: true, name: true } } },
    })

    return reply.status(201).send(serializeTerm(created))
  })

  fastify.patch('/admin/receipt-training/terms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = UpdateTermSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const existing = await prisma.receiptClassifierTerm.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'Classifier term not found' })

    const termType = body.data.termType ?? existing.termType
    let nextTerm: string | undefined
    if (body.data.term !== undefined) {
      const normalized = normalizeTrainingTerm(termType, body.data.term)
      if (!normalized) return reply.status(400).send({ error: 'Invalid classifier term' })
      nextTerm = normalized
    }

    const updated = await prisma.receiptClassifierTerm.update({
      where: { id },
      data: {
        ...(body.data.termType !== undefined && { termType }),
        ...(nextTerm !== undefined && { term: nextTerm }),
        ...(body.data.isActive !== undefined && { isActive: body.data.isActive }),
        ...(body.data.source !== undefined && { source: body.data.source.trim() || 'ADMIN' }),
      },
      include: { household: { select: { id: true, name: true } } },
    })

    return reply.send(serializeTerm(updated))
  })

  fastify.delete('/admin/receipt-training/terms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.receiptClassifierTerm.delete({ where: { id } })
    return reply.status(204).send()
  })

  fastify.post('/admin/receipt-training/subcategories', { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateSubcategorySchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const category = await prisma.category.findFirst({ where: { id: body.data.categoryId, categoryType: 'EXPENSE' } })
    if (!category) return reply.status(404).send({ error: 'Category not found' })

    const scoped = resolveScope(body.data)
    const duplicate = await prisma.receiptSubcategory.findFirst({
      where: {
        categoryId: body.data.categoryId,
        name: { equals: body.data.name.trim(), mode: 'insensitive' },
        ...(scoped.householdId ? { householdId: scoped.householdId } : { isSystemWide: true }),
      },
    })
    if (duplicate) return reply.status(409).send({ error: 'A receipt subcategory with this name already exists for this category and scope' })

    const created = await prisma.receiptSubcategory.create({
      data: {
        categoryId: body.data.categoryId,
        householdId: scoped.householdId,
        name: body.data.name.trim(),
        isSystemWide: scoped.scopeKey === 'system',
        isActive: body.data.isActive ?? true,
      },
      include: {
        category: { select: { id: true, name: true } },
        household: { select: { id: true, name: true } },
        _count: { select: { lineItems: true, mappings: true } },
      },
    })

    return reply.status(201).send(serializeSubcategory(created))
  })

  fastify.patch('/admin/receipt-training/subcategories/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = UpdateSubcategorySchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const existing = await prisma.receiptSubcategory.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'Receipt subcategory not found' })

    if (body.data.name && body.data.name.trim() !== existing.name) {
      const duplicate = await prisma.receiptSubcategory.findFirst({
        where: {
          categoryId: existing.categoryId,
          name: { equals: body.data.name.trim(), mode: 'insensitive' },
          ...(existing.householdId ? { householdId: existing.householdId } : { isSystemWide: true }),
          NOT: { id },
        },
      })
      if (duplicate) return reply.status(409).send({ error: 'A receipt subcategory with this name already exists for this category and scope' })
    }

    const updated = await prisma.receiptSubcategory.update({
      where: { id },
      data: {
        ...(body.data.name !== undefined && { name: body.data.name.trim() }),
        ...(body.data.isActive !== undefined && { isActive: body.data.isActive }),
      },
      include: {
        category: { select: { id: true, name: true } },
        household: { select: { id: true, name: true } },
        _count: { select: { lineItems: true, mappings: true } },
      },
    })

    return reply.send(serializeSubcategory(updated))
  })

  fastify.post('/admin/receipt-training/mappings', { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateMappingSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const validation = await validateMappingTargets(body.data.householdId, body.data.categoryId, body.data.subcategoryId ?? null)
    if (validation) return reply.status(400).send({ error: validation })

    const classifierConfig = await loadReceiptClassifierConfig(body.data.householdId)
    const normalizedLabel = normalizeReceiptLabel(body.data.normalizedLabel, classifierConfig)
    if (!normalizedLabel) return reply.status(400).send({ error: 'normalizedLabel is required' })

    const created = await prisma.receiptCategoryMapping.upsert({
      where: {
        householdId_normalizedLabel_merchantKey: {
          householdId: body.data.householdId,
          normalizedLabel,
          merchantKey: body.data.merchantKey?.trim() ?? '',
        },
      },
      create: {
        householdId: body.data.householdId,
        normalizedLabel,
        merchantKey: body.data.merchantKey?.trim() ?? '',
        categoryId: body.data.categoryId,
        subcategoryId: body.data.subcategoryId ?? null,
        confidence: new Decimal(body.data.confidence ?? 1),
      },
      update: {
        categoryId: body.data.categoryId,
        subcategoryId: body.data.subcategoryId ?? null,
        confidence: new Decimal(body.data.confidence ?? 1),
      },
      include: mappingInclude,
    })

    return reply.status(201).send(serializeMapping(created))
  })

  fastify.patch('/admin/receipt-training/mappings/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = UpdateMappingSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() })

    const existing = await prisma.receiptCategoryMapping.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'Receipt mapping not found' })

    const categoryId = body.data.categoryId ?? existing.categoryId
    const subcategoryId = body.data.subcategoryId !== undefined ? body.data.subcategoryId : existing.subcategoryId
    const validation = await validateMappingTargets(existing.householdId, categoryId, subcategoryId ?? null)
    if (validation) return reply.status(400).send({ error: validation })

    const classifierConfig = await loadReceiptClassifierConfig(existing.householdId)
    const normalizedLabel = body.data.normalizedLabel !== undefined
      ? normalizeReceiptLabel(body.data.normalizedLabel, classifierConfig)
      : undefined
    if (body.data.normalizedLabel !== undefined && !normalizedLabel) return reply.status(400).send({ error: 'normalizedLabel is required' })

    const updated = await prisma.receiptCategoryMapping.update({
      where: { id },
      data: {
        ...(normalizedLabel !== undefined && { normalizedLabel }),
        ...(body.data.merchantKey !== undefined && { merchantKey: body.data.merchantKey.trim() }),
        ...(body.data.categoryId !== undefined && { categoryId: body.data.categoryId }),
        ...(body.data.subcategoryId !== undefined && { subcategoryId: body.data.subcategoryId }),
        ...(body.data.confidence !== undefined && { confidence: new Decimal(body.data.confidence) }),
      },
      include: mappingInclude,
    })

    return reply.send(serializeMapping(updated))
  })

  fastify.delete('/admin/receipt-training/mappings/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.receiptCategoryMapping.delete({ where: { id } })
    return reply.status(204).send()
  })
}

const mappingInclude = {
  household: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
} as const

function resolveScope(value: { scope: 'system' } | { scope: 'household'; householdId: string }) {
  return value.scope === 'system'
    ? { scopeKey: 'system', householdId: null }
    : { scopeKey: value.householdId, householdId: value.householdId }
}

function normalizeTrainingTerm(termType: 'NOISE_TOKEN' | 'LOW_VALUE_WORD' | 'OCR_ALIAS', value: string): string | null {
  if (termType === 'OCR_ALIAS') {
    const match = value.trim().toLowerCase().match(/^(.+?)(?:=>|->)(.+)$/)
    if (!match) return null
    const source = normalizeTermSide(match[1])
    const target = normalizeTermSide(match[2])
    return source && target && source !== target ? `${source}=>${target}` : null
  }
  const term = normalizeTermSide(value)
  if (!term || term.length > 80 || /^\d+$/.test(term)) return null
  return term
}

function normalizeTermSide(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s@]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function validateMappingTargets(householdId: string, categoryId: string, subcategoryId: string | null): Promise<string | null> {
  const [household, category] = await Promise.all([
    prisma.household.findUnique({ where: { id: householdId }, select: { id: true } }),
    prisma.category.findFirst({
      where: {
        id: categoryId,
        categoryType: 'EXPENSE',
        OR: [{ isSystemWide: true }, { householdId }],
      },
      select: { id: true },
    }),
  ])
  if (!household) return 'Household not found'
  if (!category) return 'Category not found'
  if (!subcategoryId) return null

  const subcategory = await prisma.receiptSubcategory.findFirst({
    where: {
      id: subcategoryId,
      categoryId,
      OR: [{ isSystemWide: true }, { householdId }],
    },
    select: { id: true },
  })
  return subcategory ? null : 'Subcategory not found for category'
}

function serializeTerm(term: any) {
  return {
    id: term.id,
    scopeKey: term.scopeKey,
    scope: term.scopeKey === 'system' ? 'system' : 'household',
    householdId: term.householdId,
    householdName: term.household?.name ?? null,
    termType: term.termType,
    term: term.term,
    isActive: term.isActive,
    source: term.source,
    hitCount: term.hitCount,
    lastSeenAt: term.lastSeenAt?.toISOString?.() ?? term.lastSeenAt ?? null,
    updatedAt: term.updatedAt?.toISOString?.() ?? term.updatedAt,
  }
}

function serializeSubcategory(subcategory: any) {
  return {
    id: subcategory.id,
    categoryId: subcategory.categoryId,
    categoryName: subcategory.category?.name ?? '',
    householdId: subcategory.householdId,
    householdName: subcategory.household?.name ?? null,
    name: subcategory.name,
    isSystemWide: subcategory.isSystemWide,
    isActive: subcategory.isActive,
    lineItemCount: subcategory._count?.lineItems ?? 0,
    mappingCount: subcategory._count?.mappings ?? 0,
    updatedAt: subcategory.updatedAt?.toISOString?.() ?? subcategory.updatedAt,
  }
}

function serializeMapping(mapping: any) {
  return {
    id: mapping.id,
    householdId: mapping.householdId,
    householdName: mapping.household?.name ?? '',
    normalizedLabel: mapping.normalizedLabel,
    merchantKey: mapping.merchantKey,
    categoryId: mapping.categoryId,
    categoryName: mapping.category?.name ?? '',
    subcategoryId: mapping.subcategoryId,
    subcategoryName: mapping.subcategory?.name ?? null,
    confidence: Number(mapping.confidence),
    hitCount: mapping.hitCount,
    lastUsedAt: mapping.lastUsedAt?.toISOString?.() ?? mapping.lastUsedAt,
    updatedAt: mapping.updatedAt?.toISOString?.() ?? mapping.updatedAt,
  }
}
