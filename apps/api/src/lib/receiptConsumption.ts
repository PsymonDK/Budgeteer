import { BASE_CURRENCY, getLatestRate } from './currency'

export type ReceiptSummaryPeriod =
  | 'allTime'
  | 'currentMonth'
  | 'previousMonth'
  | 'currentQuarter'
  | 'previousQuarter'
  | 'currentYear'
  | 'previousYear'
  | 'last12Months'
  | 'custom'

export interface ReceiptSummaryQuery {
  period?: ReceiptSummaryPeriod
  startDate?: string
  endDate?: string
  year?: number
  month?: number
}

export interface ReceiptSummaryDateFilter {
  gte: Date
  lt: Date
}

interface ReceiptSummaryLineItem {
  amount: { toString(): string } | null | undefined
  currencyCode?: string | null
  categoryId?: string | null
  subcategoryId?: string | null
  category?: { name: string; icon: string | null } | null
  subcategory?: { name: string } | null
  receipt: {
    purchaseDate: Date | null
    currencyCode?: string | null
  }
}

export interface ReceiptConsumptionSummary {
  total: string
  itemCount: number
  baseCurrency: string
  period: ReceiptSummaryPeriod | 'legacy'
  startDate: string | null
  endDate: string | null
  warnings: string[]
  byCategory: Array<{ categoryId: string | null; categoryName: string; categoryIcon: string | null; total: string; itemCount: number }>
  bySubcategory: Array<{ categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: string; itemCount: number }>
  byMonth: Array<{ month: string; total: string }>
}

export function buildReceiptSummaryDateFilter(query: ReceiptSummaryQuery, now = new Date()): {
  filter: ReceiptSummaryDateFilter | null
  period: ReceiptConsumptionSummary['period']
} {
  if (query.period === 'currentMonth') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }, period: 'currentMonth' }
  }

  if (query.period === 'previousMonth') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) }, period: 'previousMonth' }
  }

  if (query.period === 'currentQuarter') {
    const startMonth = quarterStartMonth(now.getUTCMonth())
    const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 1)) }, period: 'currentQuarter' }
  }

  if (query.period === 'previousQuarter') {
    const currentQuarterStartMonth = quarterStartMonth(now.getUTCMonth())
    const start = new Date(Date.UTC(now.getUTCFullYear(), currentQuarterStartMonth - 3, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), currentQuarterStartMonth, 1)) }, period: 'previousQuarter' }
  }

  if (query.period === 'currentYear') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)) }, period: 'currentYear' }
  }

  if (query.period === 'previousYear') {
    const start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) }, period: 'previousYear' }
  }

  if (query.period === 'last12Months') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
    return { filter: { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }, period: 'last12Months' }
  }

  if (query.period === 'custom') {
    if (!query.startDate || !query.endDate) throw new Error('Custom receipt summary requires startDate and endDate')
    const start = parseDateOnly(query.startDate)
    const end = parseDateOnly(query.endDate)
    if (start.getTime() > end.getTime()) throw new Error('startDate must be before or equal to endDate')
    return { filter: { gte: start, lt: addUtcDays(end, 1) }, period: 'custom' }
  }

  if (query.year) {
    const start = new Date(Date.UTC(query.year, query.month ? query.month - 1 : 0, 1))
    const end = query.month ? new Date(Date.UTC(query.year, query.month, 1)) : new Date(Date.UTC(query.year + 1, 0, 1))
    return { filter: { gte: start, lt: end }, period: 'legacy' }
  }

  if (query.period === 'allTime') return { filter: null, period: 'allTime' }

  return { filter: null, period: 'allTime' }
}

export async function summarizeReceiptConsumption(lineItems: ReceiptSummaryLineItem[], periodInfo: {
  period: ReceiptConsumptionSummary['period']
  filter: ReceiptSummaryDateFilter | null
}): Promise<ReceiptConsumptionSummary> {
  const rateCache = new Map<string, number | null>([[BASE_CURRENCY, 1]])
  const warnings = new Set<string>()
  const byCategory = new Map<string, { categoryId: string | null; categoryName: string; categoryIcon: string | null; total: number; itemCount: number }>()
  const bySubcategory = new Map<string, { categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: number; itemCount: number }>()
  const byMonth = new Map<string, number>()
  let total = 0
  let itemCount = 0

  for (const item of lineItems) {
    const currencyCode = (item.receipt.currencyCode ?? item.currencyCode ?? BASE_CURRENCY).toUpperCase()
    const rate = await getReceiptRate(currencyCode, rateCache)
    if (rate == null) {
      warnings.add(`Missing exchange rate for ${currencyCode}; matching receipt lines were excluded.`)
      continue
    }

    const amount = Number.parseFloat(item.amount?.toString() ?? '0') * rate
    total += amount
    itemCount += 1

    const categoryKey = item.categoryId ?? '__uncategorized__'
    const category = byCategory.get(categoryKey) ?? {
      categoryId: item.categoryId ?? null,
      categoryName: item.category?.name ?? 'Uncategorized',
      categoryIcon: item.category?.icon ?? null,
      total: 0,
      itemCount: 0,
    }
    category.total += amount
    category.itemCount += 1
    byCategory.set(categoryKey, category)

    const subcategoryKey = item.subcategoryId ?? `${categoryKey}::__uncategorized__`
    const subcategory = bySubcategory.get(subcategoryKey) ?? {
      categoryId: item.categoryId ?? null,
      categoryName: item.category?.name ?? 'Uncategorized',
      subcategoryId: item.subcategoryId ?? null,
      subcategoryName: item.subcategory?.name ?? 'No subcategory',
      total: 0,
      itemCount: 0,
    }
    subcategory.total += amount
    subcategory.itemCount += 1
    bySubcategory.set(subcategoryKey, subcategory)

    if (item.receipt.purchaseDate) {
      const monthKey = item.receipt.purchaseDate.toISOString().slice(0, 7)
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount)
    }
  }

  return {
    total: total.toFixed(2),
    itemCount,
    baseCurrency: BASE_CURRENCY,
    period: periodInfo.period,
    startDate: periodInfo.filter?.gte.toISOString().slice(0, 10) ?? null,
    endDate: periodInfo.filter ? addUtcDays(periodInfo.filter.lt, -1).toISOString().slice(0, 10) : null,
    warnings: [...warnings],
    byCategory: [...byCategory.values()]
      .sort((a, b) => b.total - a.total)
      .map((row) => ({ ...row, total: row.total.toFixed(2) })),
    bySubcategory: [...bySubcategory.values()]
      .sort((a, b) => b.total - a.total)
      .map((row) => ({ ...row, total: row.total.toFixed(2) })),
    byMonth: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, total: amount.toFixed(2) })),
  }
}

async function getReceiptRate(currencyCode: string, cache: Map<string, number | null>) {
  if (cache.has(currencyCode)) return cache.get(currencyCode) ?? null
  const rate = await getLatestRate(currencyCode)
  cache.set(currencyCode, rate)
  return rate
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('Invalid date format')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Invalid calendar date')
  }
  return date
}

function quarterStartMonth(month: number) {
  return Math.floor(month / 3) * 3
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}
