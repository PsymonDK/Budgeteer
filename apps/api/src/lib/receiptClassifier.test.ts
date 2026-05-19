import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedReceipt } from './receiptParser'

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
    updateMany: vi.fn(),
  },
}))

vi.mock('./prisma', () => ({ prisma: prismaMock }))

import { applyCategorySuggestions, learnReceiptMappings, normalizeReceiptLabel } from './receiptClassifier'

const categories = [
  {
    id: 'cat-food',
    name: 'Food & Groceries',
    isSystemWide: true,
    householdId: null,
    receiptSubcategories: [
      { id: 'sub-food', name: 'Food', isSystemWide: true, householdId: null },
      { id: 'sub-meat', name: 'Meat', isSystemWide: true, householdId: null },
    ],
  },
  {
    id: 'cat-transport',
    name: 'Transport',
    isSystemWide: true,
    householdId: null,
    receiptSubcategories: [
      { id: 'sub-fuel', name: 'Fuel', isSystemWide: true, householdId: null },
      { id: 'sub-parking', name: 'Parking', isSystemWide: true, householdId: null },
    ],
  },
]

describe('receiptClassifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.RECEIPT_AI_CATEGORIZE
    delete process.env.LOCAL_AI_BASE_URL
    delete process.env.LOCAL_AI_MODEL
    prismaMock.category.findMany.mockResolvedValue(categories)
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([])
    prismaMock.receiptCategoryMapping.upsert.mockResolvedValue({})
    prismaMock.receiptClassifierTerm.findMany.mockResolvedValue([])
    prismaMock.receiptClassifierTerm.upsert.mockResolvedValue({})
    prismaMock.receiptClassifierTerm.updateMany.mockResolvedValue({ count: 0 })
  })

  it('uses exact learned mappings for the same merchant first', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food' }),
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'rema 1000', categoryId: 'cat-transport', subcategoryId: 'sub-fuel' }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic Milk', 'organic milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({
      categoryId: 'cat-food',
      subcategoryId: 'sub-food',
      confidence: 'MEDIUM',
    })
  })

  it('uses exact learned mappings across merchants when there is no same-merchant match', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food' }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Rema 1000', [
      item('Organic Milk', 'organic milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({ categoryId: 'cat-food', subcategoryId: 'sub-food' })
  })

  it('uses global mappings when no household mapping exists', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ scopeKey: 'system', householdId: null, normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food' }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic Milk', 'organic milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({ categoryId: 'cat-food', subcategoryId: 'sub-food' })
  })

  it('prefers household mappings over matching global mappings', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ scopeKey: 'system', householdId: null, normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food' }),
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-transport', subcategoryId: 'sub-fuel' }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic Milk', 'organic milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({ categoryId: 'cat-transport', subcategoryId: 'sub-fuel' })
  })

  it('uses fuzzy historical matches for similar confirmed labels', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food', hitCount: 8 }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic whole milk', 'organic whole milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({
      categoryId: 'cat-food',
      subcategoryId: 'sub-food',
      confidence: 'HIGH',
    })
  })

  it('tries household fuzzy mappings before global fuzzy mappings', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ scopeKey: 'system', householdId: null, normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food', hitCount: 20 }),
      mapping({ normalizedLabel: 'organic whole malk', merchantKey: 'netto', categoryId: 'cat-transport', subcategoryId: 'sub-fuel', hitCount: 1 }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic whole milk', 'organic whole milk'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({ categoryId: 'cat-transport', subcategoryId: 'sub-fuel' })
  })

  it('normalizes common OCR, package, receipt code, and trailing price noise', () => {
    expect(normalizeReceiptLabel('3651001 TV-bord LYNGVIG 160cm 2.499,00')).toBe('tv bord lyngvig')
    expect(normalizeReceiptLabel('2 x Organic Milk, 1L 12,95')).toBe('organic milk')
    expect(normalizeReceiptLabel('VARENR 90425 Rugbrød - ØKO')).toBe('rugbrød øko')
    expect(normalizeReceiptLabel('TOTLET')).toBe('toilet')
    expect(normalizeReceiptLabel('CHILT SAUCE')).toBe('chili sauce')
    expect(normalizeReceiptLabel('MINIMALK')).toBe('minimælk')
  })

  it('uses token-aware fuzzy matches for package-size variants', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'tv bord lyngvig', merchantKey: 'jysk', categoryId: 'cat-food', subcategoryId: 'sub-food', hitCount: 4 }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('JYSK', [
      item('TV-bord LYNGVIG 160cm', normalizeReceiptLabel('TV-bord LYNGVIG 160cm')),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({
      categoryId: 'cat-food',
      subcategoryId: 'sub-food',
      confidence: 'MEDIUM',
    })
  })

  it('uses OCR-confusion-aware fuzzy matches for spelling errors', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food', hitCount: 4 }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Netto', [
      item('Organic Mi1k', normalizeReceiptLabel('Organic Mi1k')),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({
      categoryId: 'cat-food',
      subcategoryId: 'sub-food',
      confidence: 'HIGH',
    })
  })

  it('does not fuzzy match below conservative thresholds', async () => {
    prismaMock.receiptCategoryMapping.findMany.mockResolvedValue([
      mapping({ normalizedLabel: 'organic milk', merchantKey: 'netto', categoryId: 'cat-food', subcategoryId: 'sub-food', hitCount: 20 }),
    ])

    const receipt = await applyCategorySuggestions(baseReceipt('Other shop', [
      item('Diesel fuel', 'diesel fuel'),
    ]), 'household-1')

    expect(receipt.lineItems[0].categoryId).toBe('cat-transport')
    expect(receipt.lineItems[0].subcategoryId).toBe('sub-fuel')
  })

  it('falls back to deterministic keyword rules', async () => {
    const receipt = await applyCategorySuggestions(baseReceipt('Circle K', [
      item('Benzin oktan 95', 'benzin oktan'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({
      categoryId: 'cat-transport',
      subcategoryId: 'sub-fuel',
      confidence: 'MEDIUM',
    })
  })

  it('leaves unknown lines unclassified when no classifier can match them', async () => {
    const receipt = await applyCategorySuggestions(baseReceipt('Unknown', [
      item('Mystery item', 'mystery item'),
    ]), 'household-1')

    expect(receipt.lineItems[0].categoryId).toBeUndefined()
    expect(receipt.lineItems[0].subcategoryId).toBeUndefined()
  })

  it('applies only valid local AI category suggestions', async () => {
    process.env.RECEIPT_AI_CATEGORIZE = 'true'
    process.env.LOCAL_AI_BASE_URL = 'http://ollama:11434'
    process.env.LOCAL_AI_MODEL = 'qwen2.5'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          suggestions: [
            { index: 0, categoryId: 'cat-food', subcategoryId: 'sub-food', confidence: 0.91 },
            { index: 1, categoryId: 'cat-missing', subcategoryId: null, confidence: 0.95 },
            { index: 2, categoryId: 'cat-food', subcategoryId: 'sub-fuel', confidence: 0.95 },
            { index: 3, categoryId: 'cat-transport', subcategoryId: 'sub-parking', confidence: 0.42 },
          ],
        }),
      }),
    }))

    const receipt = await applyCategorySuggestions(baseReceipt('Local shop', [
      item('Puzzle box', 'puzzle box'),
      item('Hidden thing', 'hidden thing'),
      item('Wrong subcategory', 'wrong subcategory'),
      item('Weak guess', 'weak guess'),
    ]), 'household-1')

    expect(receipt.lineItems[0]).toMatchObject({ categoryId: 'cat-food', subcategoryId: 'sub-food', confidence: 'HIGH' })
    expect(receipt.lineItems[1].categoryId).toBeUndefined()
    expect(receipt.lineItems[2].categoryId).toBeUndefined()
    expect(receipt.lineItems[3].categoryId).toBeUndefined()
  })

  it('falls back cleanly when local AI categorization fails', async () => {
    process.env.RECEIPT_AI_CATEGORIZE = 'true'
    process.env.LOCAL_AI_BASE_URL = 'http://ollama:11434'
    process.env.LOCAL_AI_MODEL = 'qwen2.5'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const receipt = await applyCategorySuggestions(baseReceipt('Local shop', [
      item('Mystery item', 'mystery item'),
    ]), 'household-1')

    expect(receipt.lineItems[0].categoryId).toBeUndefined()
    expect(receipt.notes.at(-1)).toContain('Local AI categorizer failed with 500')
  })

  it('does not learn OCR alias source words as noise tokens', async () => {
    prismaMock.receiptClassifierTerm.findMany.mockResolvedValue([
      { scopeKey: 'system', termType: 'OCR_ALIAS', term: 'totlet=>toilet', isActive: true },
    ])

    await learnReceiptMappings({
      householdId: 'household-1',
      merchantName: 'Netto',
      items: [{
        originalText: 'LOTUS TOTLET 20,00',
        label: 'LOTUS TOTLET',
        normalizedLabel: 'lotus toilet',
        categoryId: 'cat-food',
        subcategoryId: 'sub-food',
      }],
    })

    expect(prismaMock.receiptClassifierTerm.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_termType_term: { scopeKey: 'household-1', termType: 'NOISE_TOKEN', term: 'totlet' } },
    }))
    expect(prismaMock.receiptCategoryMapping.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_normalizedLabel_merchantKey: { scopeKey: 'household-1', normalizedLabel: 'lotus toilet', merchantKey: 'netto' } },
      create: expect.objectContaining({ scopeKey: 'household-1', householdId: 'household-1' }),
    }))
  })
})

function baseReceipt(merchantName: string, lineItems: ParsedReceipt['lineItems']): ParsedReceipt {
  return {
    merchantName,
    purchaseDate: '2026-05-18',
    totalAmount: null,
    taxAmount: null,
    feeAmount: null,
    currencyCode: 'DKK',
    confidence: 'MEDIUM',
    notes: [],
    lineItems,
  }
}

function item(label: string, normalizedLabel: string): ParsedReceipt['lineItems'][number] {
  return {
    originalText: `${label} 10,00`,
    label,
    normalizedLabel,
    amount: 10,
    confidence: 'LOW',
  }
}

function mapping(overrides: Partial<{
  scopeKey: string
  householdId: string | null
  categoryId: string
  subcategoryId: string | null
  normalizedLabel: string
  merchantKey: string
  hitCount: number
  lastUsedAt: Date
}>) {
  return {
    scopeKey: 'household-1',
    householdId: 'household-1',
    categoryId: 'cat-food',
    subcategoryId: 'sub-food',
    normalizedLabel: 'organic milk',
    merchantKey: 'netto',
    hitCount: 1,
    lastUsedAt: new Date(),
    ...overrides,
  }
}
