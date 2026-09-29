import { BudgetStatus } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import { calcMonthlyInBase } from './calculations'
import { recalculateTransfer } from './budgetTransfer'

export const BASE_CURRENCY = (process.env.BASE_CURRENCY || 'DKK').toUpperCase()

interface CurrencyEntry {
  code: string
  rate: number // 1 unit of code = rate units of BASE_CURRENCY
}

export async function fetchRates(): Promise<CurrencyEntry[]> {
  const { XMLParser } = await import('fast-xml-parser')

  const resp = await fetch('https://www.nationalbanken.dk/api/currencyratesxml?lang=da')
  if (!resp.ok) throw new Error(`Nationalbank API returned ${resp.status}`)

  const xml = await resp.text()
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml)

  const rawCurrencies = doc?.exchangerates?.dailyrates?.currency
  const currencies = Array.isArray(rawCurrencies) ? rawCurrencies : rawCurrencies ? [rawCurrencies] : []

  // Build map: code → (DKK per 1 unit of currency)
  const dkkRates = new Map<string, number>()
  dkkRates.set('DKK', 1)

  for (const c of currencies) {
    const code = (c['@_code'] as string).toUpperCase()
    const unit = parseFloat(c['@_unit'] as string) || 100
    const rate = parseFloat((c['@_rate'] as string).replace(',', '.'))
    dkkRates.set(code, rate / unit)
  }

  // Cross-calculate to BASE_CURRENCY if not DKK
  const baseInDkk = BASE_CURRENCY === 'DKK' ? 1 : (dkkRates.get(BASE_CURRENCY) ?? 1)

  const result: CurrencyEntry[] = []
  for (const [code, dkkRate] of dkkRates) {
    result.push({ code, rate: dkkRate / baseInDkk })
  }

  return result
}

export async function syncRates(): Promise<number> {
  const currencies = await fetchRates()
  const fetchedDate = new Date()

  await prisma.currencyRate.createMany({
    data: currencies.map(({ code, rate }) => ({
      currencyCode: code,
      rate,
      baseCurrency: BASE_CURRENCY,
      fetchedDate,
    })),
  })

  // Lock first: an entry whose payment date has passed keeps the rate of that date
  // and must not be moved to today's rate by the recalculation below.
  const locked = await lockPastEntryRates()
  const recalculated = await recalcUnlockedEntries(new Map(currencies.map((c) => [c.code, new Decimal(c.rate)])))

  // Keep derived transfers in step with the new monthly equivalents
  for (const budgetYearId of new Set([...locked, ...recalculated])) {
    await recalculateTransfer(budgetYearId)
  }

  return currencies.length
}

export async function getLatestRate(currencyCode: string): Promise<number | null> {
  const upper = currencyCode.toUpperCase()
  if (upper === BASE_CURRENCY) return 1

  const row = await prisma.currencyRate.findFirst({
    where: { currencyCode: upper, baseCurrency: BASE_CURRENCY },
    orderBy: { fetchedDate: 'desc' },
  })

  return row ? parseFloat(row.rate.toString()) : null
}

/** Most recent stored rate on or before a date, or null if none was fetched by then. */
export async function getRateOnOrBefore(currencyCode: string, date: Date): Promise<Decimal | null> {
  const row = await prisma.currencyRate.findFirst({
    where: { currencyCode: currencyCode.toUpperCase(), baseCurrency: BASE_CURRENCY, fetchedDate: { lte: date } },
    orderBy: { fetchedDate: 'desc' },
  })
  return row ? new Decimal(row.rate.toString()) : null
}

/**
 * The rate to store when an entry is saved. A locked rate (rateDate set) is kept only
 * while the currency is unchanged; switching currency takes the latest rate for the
 * new currency and unlocks. Returns null when no rate exists for the currency.
 */
export async function resolveSaveRate(
  currency: string,
  existing?: { currencyCode: string | null; rateUsed: Decimal | null; rateDate: Date | null } | null,
): Promise<{ rate: Decimal; rateDate: Date | null } | null> {
  if (currency === BASE_CURRENCY) return { rate: new Decimal(1), rateDate: null }
  if (existing?.rateDate && existing.rateUsed && existing.currencyCode === currency) {
    return { rate: new Decimal(existing.rateUsed.toString()), rateDate: existing.rateDate }
  }
  const latest = await getLatestRate(currency)
  return latest === null ? null : { rate: new Decimal(latest), rateDate: null }
}

// Retired years are read-only history; the FX sync never rewrites them.
const EDITABLE_YEAR = { budgetYear: { status: { in: ['ACTIVE', 'FUTURE', 'SIMULATION'] as BudgetStatus[] } } }

/**
 * Re-prices unlocked foreign-currency entries at the latest rate. Uses the same
 * calculation as saving (including the partial-year average for expenses).
 * Returns the ids of budget years whose entries changed.
 */
async function recalcUnlockedEntries(rates: Map<string, Decimal>): Promise<Set<string>> {
  const touched = new Set<string>()

  const expenses = await prisma.expense.findMany({
    where: { currencyCode: { not: null }, rateDate: null, ...EDITABLE_YEAR },
  })
  for (const e of expenses) {
    const rate = e.currencyCode && e.currencyCode !== BASE_CURRENCY ? rates.get(e.currencyCode) : undefined
    if (!rate) continue
    const monthly = calcMonthlyInBase(e.originalAmount ?? e.amount, rate, e.frequency, e.startMonth, e.endMonth)
    if (monthly.toDecimalPlaces(2).eq(new Decimal(e.monthlyEquivalent.toString())) && e.rateUsed && rate.eq(new Decimal(e.rateUsed.toString()))) continue
    await prisma.expense.update({ where: { id: e.id }, data: { rateUsed: rate, monthlyEquivalent: monthly } })
    touched.add(e.budgetYearId)
  }

  const savings = await prisma.savingsEntry.findMany({
    where: { currencyCode: { not: null }, rateDate: null, ...EDITABLE_YEAR },
  })
  for (const s of savings) {
    const rate = s.currencyCode && s.currencyCode !== BASE_CURRENCY ? rates.get(s.currencyCode) : undefined
    if (!rate) continue
    const monthly = calcMonthlyInBase(s.originalAmount ?? s.amount, rate, s.frequency)
    if (monthly.toDecimalPlaces(2).eq(new Decimal(s.monthlyEquivalent.toString())) && s.rateUsed && rate.eq(new Decimal(s.rateUsed.toString()))) continue
    await prisma.savingsEntry.update({ where: { id: s.id }, data: { rateUsed: rate, monthlyEquivalent: monthly } })
    touched.add(s.budgetYearId)
  }

  return touched
}

/**
 * Locks entries whose payment period has passed at the rate in effect on that date
 * (falling back to the rate already stored when no history reaches back that far),
 * re-pricing them at that rate. Returns the ids of budget years that changed.
 */
async function lockPastEntryRates(now: Date = new Date()): Promise<Set<string>> {
  const touched = new Set<string>()
  const where = { currencyCode: { not: null }, rateDate: null, frequencyPeriod: { not: null }, ...EDITABLE_YEAR }

  for (const e of await prisma.expense.findMany({ where })) {
    const periodDate = e.frequencyPeriod ? parsePeriodDate(e.frequencyPeriod) : null
    if (!e.currencyCode || !periodDate || periodDate > now) continue
    const rate = (await getRateOnOrBefore(e.currencyCode, periodDate)) ?? (e.rateUsed ? new Decimal(e.rateUsed.toString()) : null)
    if (!rate) continue
    const monthly = calcMonthlyInBase(e.originalAmount ?? e.amount, rate, e.frequency, e.startMonth, e.endMonth)
    await prisma.expense.update({ where: { id: e.id }, data: { rateDate: periodDate, rateUsed: rate, monthlyEquivalent: monthly } })
    touched.add(e.budgetYearId)
  }

  for (const s of await prisma.savingsEntry.findMany({ where })) {
    const periodDate = s.frequencyPeriod ? parsePeriodDate(s.frequencyPeriod) : null
    if (!s.currencyCode || !periodDate || periodDate > now) continue
    const rate = (await getRateOnOrBefore(s.currencyCode, periodDate)) ?? (s.rateUsed ? new Decimal(s.rateUsed.toString()) : null)
    if (!rate) continue
    const monthly = calcMonthlyInBase(s.originalAmount ?? s.amount, rate, s.frequency)
    await prisma.savingsEntry.update({ where: { id: s.id }, data: { rateDate: periodDate, rateUsed: rate, monthlyEquivalent: monthly } })
    touched.add(s.budgetYearId)
  }

  return touched
}

export function parsePeriodDate(period: string): Date | null {
  const full = Date.parse(period)
  if (!isNaN(full)) return new Date(full)
  const ym = /^(\d{4})-(\d{2})$/.exec(period)
  if (ym) return new Date(parseInt(ym[1]), parseInt(ym[2]) - 1, 1)
  return null
}
