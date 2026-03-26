import { prisma } from './prisma'
import { calcMonthlyEquivalent } from './calculations'
import { Decimal } from '@prisma/client/runtime/client'

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

  await recalcFutureExpenses(currencies)
  await lockPastExpenseRates()

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

async function recalcFutureExpenses(currencies: CurrencyEntry[]) {
  const rateMap = new Map(currencies.map((c) => [c.code, c.rate]))

  const expenses = await prisma.expense.findMany({
    where: { currencyCode: { not: null }, rateDate: null },
  })

  for (const expense of expenses) {
    if (!expense.currencyCode || expense.currencyCode === BASE_CURRENCY) continue
    const rate = rateMap.get(expense.currencyCode)
    if (!rate) continue

    const origAmt = expense.originalAmount ?? expense.amount
    const monthly = calcMonthlyEquivalent(
      new Decimal(parseFloat(origAmt.toString()) * rate),
      expense.frequency
    )

    await prisma.expense.update({
      where: { id: expense.id },
      data: { rateUsed: rate, monthlyEquivalent: monthly },
    })
  }

  const savings = await prisma.savingsEntry.findMany({
    where: { currencyCode: { not: null }, rateDate: null },
  })

  for (const entry of savings) {
    if (!entry.currencyCode || entry.currencyCode === BASE_CURRENCY) continue
    const rate = rateMap.get(entry.currencyCode)
    if (!rate) continue

    const origAmt = entry.originalAmount ?? entry.amount
    const monthly = calcMonthlyEquivalent(
      new Decimal(parseFloat(origAmt.toString()) * rate),
      entry.frequency
    )

    await prisma.savingsEntry.update({
      where: { id: entry.id },
      data: { rateUsed: rate, monthlyEquivalent: monthly },
    })
  }
}

async function lockPastExpenseRates() {
  const now = new Date()

  const expenses = await prisma.expense.findMany({
    where: { currencyCode: { not: null }, rateDate: null, frequencyPeriod: { not: null } },
  })

  for (const expense of expenses) {
    if (!expense.frequencyPeriod || !expense.rateUsed) continue
    const periodDate = parsePeriodDate(expense.frequencyPeriod)
    if (!periodDate || periodDate > now) continue
    await prisma.expense.update({ where: { id: expense.id }, data: { rateDate: periodDate } })
  }

  const savings = await prisma.savingsEntry.findMany({
    where: { currencyCode: { not: null }, rateDate: null, frequencyPeriod: { not: null } },
  })

  for (const entry of savings) {
    if (!entry.frequencyPeriod || !entry.rateUsed) continue
    const periodDate = parsePeriodDate(entry.frequencyPeriod)
    if (!periodDate || periodDate > now) continue
    await prisma.savingsEntry.update({ where: { id: entry.id }, data: { rateDate: periodDate } })
  }
}

function parsePeriodDate(period: string): Date | null {
  const full = Date.parse(period)
  if (!isNaN(full)) return new Date(full)
  const ym = /^(\d{4})-(\d{2})$/.exec(period)
  if (ym) return new Date(parseInt(ym[1]), parseInt(ym[2]) - 1, 1)
  return null
}
