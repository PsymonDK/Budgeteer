import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'

const prismaMock = vi.hoisted(() => ({
  category: {
    findMany: vi.fn(),
  },
  receiptCategoryMapping: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  receiptClassifierTerm: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('./prisma', () => ({ prisma: prismaMock }))

import { buildReceiptMappingExportKit, confirmReceiptMappingImport, previewReceiptMappingImport } from './receiptMappingImport'

const categories = [
  {
    id: 'cat-food',
    name: 'Food & Groceries',
    receiptSubcategories: [
      { id: 'sub-food', name: 'Food' },
      { id: 'sub-meat', name: 'Meat' },
    ],
  },
  {
    id: 'cat-transport',
    name: 'Transport',
    receiptSubcategories: [
      { id: 'sub-fuel', name: 'Fuel' },
    ],
  },
]

describe('receiptMappingImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    prismaMock.category.findMany.mockResolvedValue(categories)
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      existingMapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food' }),
    ])
    prismaMock.receiptClassifierTerm.findMany.mockResolvedValue([
      { scopeKey: 'system', termType: 'NOISE_TOKEN', term: 'stk', isActive: true, source: 'SYSTEM', hitCount: 0 },
      { scopeKey: 'household-1', termType: 'LOW_VALUE_WORD', term: 'bonus', isActive: true, source: 'CSV_IMPORT', hitCount: 1 },
    ])
  })

  it('builds an LLM export kit with prompt, category catalog, template, and existing mappings', async () => {
    const kit = await buildReceiptMappingExportKit('household-1')

    expect(kit.prompt).toContain('Return CSV only')
    expect(kit.categoryCsv).toContain('cat-food')
    expect(kit.templateCsv).toContain('merchantName,merchantKey,originalLabel')
    expect(kit.existingMappingsCsv).toContain('organic milk')
    expect(kit.classifierTermCsv).toContain('NOISE_TOKEN')
  })

  it('previews creates, updates, unchanged rows, skipped low-confidence rows, invalid rows, and duplicate rows', async () => {
    const preview = await previewReceiptMappingImport('household-1', csv([
      row({ originalLabel: 'Organic Milk 1L 12,95', normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food', confidence: '0.95' }),
      row({ originalLabel: 'Organic Milk 1L 12,95', normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-transport', subcategoryId: 'sub-fuel', confidence: '0.95' }),
      row({ originalLabel: 'Diesel 100,00', normalizedLabel: 'diesel', merchantKey: 'circle k', categoryId: 'cat-transport', subcategoryId: 'sub-fuel', confidence: '0.91' }),
      row({ originalLabel: 'Guess', normalizedLabel: 'guess', merchantKey: 'shop', categoryId: 'cat-food', subcategoryId: '', confidence: '0.30' }),
      row({ originalLabel: 'Bad category', normalizedLabel: 'bad category', merchantKey: 'shop', categoryId: 'missing', subcategoryId: '', confidence: '0.90' }),
      row({ originalLabel: 'Wrong subcategory', normalizedLabel: 'wrong subcategory', merchantKey: 'shop', categoryId: 'cat-food', subcategoryId: 'sub-fuel', confidence: '0.90' }),
      termRow({ termType: 'NOISE_TOKEN', term: 'varenr', isActive: 'true' }),
      termRow({ termType: 'LOW_VALUE_WORD', term: 'bonus', isActive: 'true' }),
      termRow({ termType: 'OCR_ALIAS', term: 'totlet=>toilet', isActive: 'true' }),
    ]))

    expect(preview.counts).toMatchObject({
      total: 9,
      create: 3,
      update: 0,
      unchanged: 2,
      skipped: 1,
      invalid: 3,
    })
    expect(preview.rows[1].errors).toContain('Duplicate mapping row for merchantKey and normalizedLabel')
    expect(preview.rows[4].errors).toContain('Unknown categoryId')
    expect(preview.rows[5].errors).toContain('subcategoryId does not belong to categoryId')
  })

  it('confirms only create and update rows', async () => {
    const result = await confirmReceiptMappingImport('household-1', csv([
      row({ originalLabel: 'Organic Milk 1L', normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-transport', subcategoryId: 'sub-fuel', confidence: '0.8' }),
      row({ originalLabel: 'Diesel', normalizedLabel: 'diesel', merchantKey: 'circle k', categoryId: 'cat-transport', subcategoryId: 'sub-fuel', confidence: '0.9' }),
      row({ originalLabel: 'Invalid', normalizedLabel: 'invalid', merchantKey: 'x', categoryId: 'missing', confidence: '0.9' }),
      termRow({ termType: 'NOISE_TOKEN', term: 'varenr', isActive: 'true' }),
      termRow({ termType: 'OCR_ALIAS', term: 'chilt=>chili', isActive: 'true' }),
    ]))

    expect(result.counts).toMatchObject({ update: 1, create: 3, invalid: 1 })
    expect(prismaMock.receiptCategoryMapping.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMock.receiptClassifierTerm.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMock.receiptCategoryMapping.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { householdId_normalizedLabel_merchantKey: { householdId: 'household-1', normalizedLabel: 'organic milk', merchantKey: 'netto' } },
      update: expect.objectContaining({ categoryId: 'cat-transport', subcategoryId: 'sub-fuel' }),
    }))
  })

  it('resolves portable category and subcategory names when IDs are blank', async () => {
    const preview = await previewReceiptMappingImport('household-1', csv([
      row({ originalLabel: 'Sky Mix 150 G', normalizedLabel: 'sky mix', merchantKey: '', categoryId: '', categoryName: 'Food & Groceries', subcategoryId: '', subcategoryName: 'Food', confidence: '0.9' }),
    ]))

    expect(preview.rows[0]).toMatchObject({
      status: 'create',
      categoryId: 'cat-food',
      subcategoryId: 'sub-food',
    })
  })

  it('requires the canonical CSV header', async () => {
    await expect(previewReceiptMappingImport('household-1', 'merchantName,categoryId\nNetto,cat-food')).rejects.toThrow('Missing CSV columns')
  })
})

function existingMapping(overrides: Partial<{
  categoryId: string
  subcategoryId: string | null
  normalizedLabel: string
  merchantKey: string
  confidence: Decimal
  hitCount: number
}>) {
  return {
    categoryId: 'cat-food',
    subcategoryId: 'sub-food',
    normalizedLabel: 'organic milk',
    merchantKey: 'netto',
    confidence: new Decimal(1),
    hitCount: 4,
    category: { name: 'Food & Groceries' },
    subcategory: { name: 'Food' },
    ...overrides,
  }
}

function csv(rows: string[]) {
  return [
    'merchantName,merchantKey,originalLabel,normalizedLabel,categoryId,categoryName,subcategoryId,subcategoryName,confidence,termType,term,isActive,notes',
    ...rows,
  ].join('\n')
}

function row(values: Partial<Record<'merchantName' | 'merchantKey' | 'originalLabel' | 'normalizedLabel' | 'categoryId' | 'categoryName' | 'subcategoryId' | 'subcategoryName' | 'confidence' | 'notes', string>>) {
  return [
    values.merchantName ?? 'Netto',
    values.merchantKey ?? '',
    values.originalLabel ?? '',
    values.normalizedLabel ?? '',
    values.categoryId ?? '',
    values.categoryName ?? '',
    values.subcategoryId ?? '',
    values.subcategoryName ?? '',
    values.confidence ?? '0.9',
    '',
    '',
    '',
    values.notes ?? '',
  ].map((value) => `"${value.replace(/"/g, '""')}"`).join(',')
}

function termRow(values: { termType: string; term: string; isActive?: string; notes?: string }) {
  return [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    values.termType,
    values.term,
    values.isActive ?? 'true',
    values.notes ?? '',
  ].map((value) => `"${value.replace(/"/g, '""')}"`).join(',')
}
