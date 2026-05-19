import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildReceiptSummaryDateFilter, summarizeReceiptConsumption } from './receiptConsumption'

const currencyMock = vi.hoisted(() => ({
  BASE_CURRENCY: 'DKK',
  getLatestRate: vi.fn(),
}))

vi.mock('./currency', () => currencyMock)

describe('receiptConsumption', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    currencyMock.getLatestRate.mockImplementation(async (code: string) => code === 'EUR' ? 7.5 : null)
  })

  it('builds current, previous, current-year, and custom period filters', () => {
    const now = new Date(Date.UTC(2026, 4, 19))

    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'currentMonth' }, now).filter)).toEqual(['2026-05-01', '2026-06-01'])
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'previousMonth' }, now).filter)).toEqual(['2026-04-01', '2026-05-01'])
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'currentYear' }, now).filter)).toEqual(['2026-01-01', '2027-01-01'])
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'custom', startDate: '2026-03-10', endDate: '2026-03-12' }, now).filter)).toEqual(['2026-03-10', '2026-03-13'])
  })

  it('builds rich preset period filters', () => {
    const now = new Date(Date.UTC(2026, 4, 19))

    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'allTime' }, now).filter)).toBeNull()
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'currentQuarter' }, now).filter)).toEqual(['2026-04-01', '2026-07-01'])
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'previousYear' }, now).filter)).toEqual(['2025-01-01', '2026-01-01'])
    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'last12Months' }, now).filter)).toEqual(['2025-06-01', '2026-06-01'])
  })

  it('builds previous quarter across a year boundary', () => {
    const now = new Date(Date.UTC(2026, 0, 15))

    expect(formatFilter(buildReceiptSummaryDateFilter({ period: 'previousQuarter' }, now).filter)).toEqual(['2025-10-01', '2026-01-01'])
  })

  it('rejects invalid custom periods', () => {
    expect(() => buildReceiptSummaryDateFilter({ period: 'custom', startDate: '2026-03-12', endDate: '2026-03-10' })).toThrow('startDate')
    expect(() => buildReceiptSummaryDateFilter({ period: 'custom', startDate: '2026-03-12' })).toThrow('Custom receipt summary')
    expect(() => buildReceiptSummaryDateFilter({ period: 'custom', startDate: '2026-02-31', endDate: '2026-03-01' })).toThrow('Invalid calendar date')
  })

  it('aggregates confirmed receipt lines by category and subcategory in base currency', async () => {
    const summary = await summarizeReceiptConsumption([
      line({ amount: '100.00', categoryId: 'cat-food', categoryName: 'Food', subcategoryId: 'sub-food', subcategoryName: 'Food', date: '2026-05-10', currencyCode: 'DKK' }),
      line({ amount: '10.00', categoryId: 'cat-food', categoryName: 'Food', subcategoryId: 'sub-snacks', subcategoryName: 'Snacks', date: '2026-05-11', currencyCode: 'EUR' }),
      line({ amount: '25.00', categoryId: null, categoryName: null, subcategoryId: null, subcategoryName: null, date: '2026-05-12', currencyCode: 'DKK' }),
    ], {
      period: 'currentMonth',
      filter: buildReceiptSummaryDateFilter({ period: 'currentMonth' }, new Date(Date.UTC(2026, 4, 19))).filter,
    })

    expect(summary.total).toBe('200.00')
    expect(summary.itemCount).toBe(3)
    expect(summary.baseCurrency).toBe('DKK')
    expect(summary.byCategory).toEqual([
      expect.objectContaining({ categoryId: 'cat-food', categoryName: 'Food', total: '175.00', itemCount: 2 }),
      expect.objectContaining({ categoryId: null, categoryName: 'Uncategorized', total: '25.00', itemCount: 1 }),
    ])
    expect(summary.bySubcategory).toEqual([
      expect.objectContaining({ subcategoryId: 'sub-food', subcategoryName: 'Food', total: '100.00' }),
      expect.objectContaining({ subcategoryId: 'sub-snacks', subcategoryName: 'Snacks', total: '75.00' }),
      expect.objectContaining({ subcategoryId: null, subcategoryName: 'No subcategory', total: '25.00' }),
    ])
    expect(summary.byMonth).toEqual([{ month: '2026-05', total: '200.00' }])
  })

  it('excludes foreign-currency lines when no rate is available', async () => {
    const summary = await summarizeReceiptConsumption([
      line({ amount: '10.00', categoryId: 'cat-food', categoryName: 'Food', subcategoryId: null, subcategoryName: null, date: '2026-05-10', currencyCode: 'USD' }),
    ], { period: 'currentMonth', filter: null })

    expect(summary.total).toBe('0.00')
    expect(summary.itemCount).toBe(0)
    expect(summary.warnings[0]).toContain('Missing exchange rate for USD')
  })
})

function formatFilter(filter: { gte: Date; lt: Date } | null) {
  return filter ? [filter.gte.toISOString().slice(0, 10), filter.lt.toISOString().slice(0, 10)] : null
}

function line(overrides: {
  amount: string
  categoryId: string | null
  categoryName: string | null
  subcategoryId: string | null
  subcategoryName: string | null
  date: string
  currencyCode: string
}) {
  return {
    amount: { toString: () => overrides.amount },
    currencyCode: overrides.currencyCode,
    categoryId: overrides.categoryId,
    subcategoryId: overrides.subcategoryId,
    category: overrides.categoryName ? { name: overrides.categoryName, icon: null } : null,
    subcategory: overrides.subcategoryName ? { name: overrides.subcategoryName } : null,
    receipt: {
      purchaseDate: new Date(`${overrides.date}T00:00:00.000Z`),
      currencyCode: overrides.currencyCode,
    },
  }
}
