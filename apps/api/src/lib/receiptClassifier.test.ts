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
}))

vi.mock('./prisma', () => ({ prisma: prismaMock }))

import { applyCategorySuggestions } from './receiptClassifier'

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
      { id: 'sub-parking', name: 'Parking' },
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
  categoryId: string
  subcategoryId: string | null
  normalizedLabel: string
  merchantKey: string
  hitCount: number
  lastUsedAt: Date
}>) {
  return {
    categoryId: 'cat-food',
    subcategoryId: 'sub-food',
    normalizedLabel: 'organic milk',
    merchantKey: 'netto',
    hitCount: 1,
    lastUsedAt: new Date(),
    ...overrides,
  }
}
