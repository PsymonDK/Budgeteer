/**
 * Pure income calculations for a single job.
 *
 * Every "salary for month" / "income for month" computation in the API goes
 * through this module so FX conversion, job start/end dates, monthly
 * overrides, bonuses and the stale-net tax-card fallback are applied the same
 * way everywhere. Callers preload the job's data once (see JOB_INCOME_INCLUDE
 * in incomeCalc.ts) and call these functions without further queries.
 *
 * Date conventions:
 *  - Stored date-only values (startDate, endDate, effectiveFrom, paymentDate)
 *    are created from 'YYYY-MM-DD' strings, i.e. UTC midnight, so their
 *    calendar month is read with UTC getters.
 *  - Month granularity: a salary record, job start or job end that falls on
 *    any day of a month applies to that whole month (no proration).
 *
 * Money is Decimal throughout. Amounts are not rounded here; round only when
 * formatting a response.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { calcDanishDeductions, BruttoItem, TaxCardInput } from './taxCalcDK'

// ── Input shapes (structurally compatible with Prisma rows) ───────────────────

export interface SalaryRecordData {
  effectiveFrom: Date
  grossAmount: Decimal
  netAmount: Decimal
  rateUsed: Decimal | null
  deductionsSource: string | null
}

export interface OverrideData {
  year: number
  month: number
  grossAmount: Decimal
  netAmount: Decimal
  deductionsSource: string | null
}

export type BonusBudgetMode = 'ONE_OFF' | 'SPREAD_ANNUALLY'

export interface BonusData {
  id: string
  label: string
  paymentDate: Date
  grossAmount: Decimal
  netAmount: Decimal
  includeInBudget: boolean
  budgetMode: BonusBudgetMode | null
  rateUsed: Decimal | null
}

export interface TaxCardData {
  effectiveFrom: Date
  traekprocent: Decimal
  personfradragMonthly: Decimal
  pensionEmployeePct: Decimal | null
  pensionEmployerPct: Decimal | null
  atpAmount: Decimal | null
  bruttoItems: unknown
}

export interface JobIncomeData {
  id: string
  country: string
  startDate: Date
  endDate: Date | null
  salaryRecords: SalaryRecordData[]
  overrides: OverrideData[]
  bonuses: BonusData[]
  taxCardSettings?: TaxCardData[]
}

/**
 * How bonuses are counted in a month:
 *  - 'budget': only includeInBudget bonuses. SPREAD_ANNUALLY adds net/12 to
 *    every month of the payment year; ONE_OFF (or no mode) adds the full
 *    amount to the payment month only.
 *  - 'cash':   every bonus, full amount, in its payment month (what was paid).
 *  - 'none':   salary/override only.
 */
export type BonusCounting = 'budget' | 'cash' | 'none'

export interface YearMonth {
  year: number
  /** 1-12 */
  month: number
}

export interface BonusContribution {
  bonusId: string
  label: string
  gross: Decimal
  net: Decimal
}

export type SalarySource = 'override' | 'salary' | 'none' | 'inactive'

export interface MonthlyJobIncome {
  /** Salary/override + bonuses, base currency */
  gross: Decimal
  net: Decimal
  salaryGross: Decimal
  salaryNet: Decimal
  bonusGross: Decimal
  bonusNet: Decimal
  bonuses: BonusContribution[]
  /** Whether the job is employed in this month (startDate..endDate) */
  active: boolean
  source: SalarySource
  /** The override or salary record the salary part came from, if any */
  record: SalaryRecordData | OverrideData | null
}

const ZERO = new Decimal(0)
const TWELVE = new Decimal(12)

// ── Month helpers ─────────────────────────────────────────────────────────────

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

/** Calendar month of a stored date-only value (UTC midnight). */
export function yearMonthOfStoredDate(d: Date): YearMonth {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/** Calendar month of a server-local date such as `new Date()` or `new Date(y, 0, 1)`. */
export function yearMonthOfLocalDate(d: Date): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function storedMonthIndex(d: Date): number {
  return monthIndex(d.getUTCFullYear(), d.getUTCMonth() + 1)
}

/** First instant of a calendar month, UTC — comparable with stored date-only values. */
export function monthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1))
}

function rateOf(rateUsed: Decimal | null): Decimal {
  return rateUsed ? new Decimal(rateUsed.toString()) : new Decimal(1)
}

function dec(v: Decimal): Decimal {
  return new Decimal(v.toString())
}

// ── Job activity ──────────────────────────────────────────────────────────────

/** True when the job is employed in the given month: startDate's month <= month <= endDate's month. */
export function isJobActiveInMonth(job: Pick<JobIncomeData, 'startDate' | 'endDate'>, year: number, month: number): boolean {
  const m = monthIndex(year, month)
  if (storedMonthIndex(job.startDate) > m) return false
  if (job.endDate && storedMonthIndex(job.endDate) < m) return false
  return true
}

// ── Tax cards ─────────────────────────────────────────────────────────────────

/** The most recent tax card whose effectiveFrom <= atDate, or null. */
export function pickTaxCardAt<T extends { effectiveFrom: Date }>(cards: T[], atDate: Date): T | null {
  let best: T | null = null
  for (const card of cards) {
    if (card.effectiveFrom.getTime() > atDate.getTime()) continue
    if (!best || card.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = card
  }
  return best
}

/** Map a stored TaxCardSettings row to the calcDanishDeductions input. */
export function taxCardToInput(card: TaxCardData): TaxCardInput {
  return {
    traekprocent: Number(card.traekprocent.toString()),
    personfradragMonthly: Number(card.personfradragMonthly.toString()),
    pensionEmployeePct: card.pensionEmployeePct != null ? Number(card.pensionEmployeePct.toString()) : null,
    pensionEmployerPct: card.pensionEmployerPct != null ? Number(card.pensionEmployerPct.toString()) : null,
    atpAmount: card.atpAmount != null ? Number(card.atpAmount.toString()) : null,
    bruttoItems: (card.bruttoItems as BruttoItem[] | null) ?? null,
  }
}

/**
 * When deductionsSource is null (reset by the payslip-lines migration because
 * the old algorithm was buggy) and the job is DK with a tax card effective at
 * atDate, recalculate net from the tax card. Returns null when the stored net
 * should be used as-is. Amounts are in the record's own currency.
 */
function recalculatedNet(job: JobIncomeData, deductionsSource: string | null, grossOriginal: Decimal, atDate: Date): Decimal | null {
  if (deductionsSource !== null) return null
  if (job.country !== 'DK') return null
  const card = pickTaxCardAt(job.taxCardSettings ?? [], atDate)
  if (!card) return null
  const calc = calcDanishDeductions(grossOriginal.toNumber(), taxCardToInput(card))
  return new Decimal(calc.net)
}

// ── Salary ────────────────────────────────────────────────────────────────────

/** Latest salary record effective in or before the given month. */
export function salaryRecordForMonth<T extends SalaryRecordData>(records: T[], year: number, month: number): T | null {
  const m = monthIndex(year, month)
  let best: T | null = null
  for (const r of records) {
    if (storedMonthIndex(r.effectiveFrom) > m) continue
    if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r
  }
  return best
}

/**
 * Salary part of a job's income for one month, in base currency.
 * A monthly override beats the salary record for that month. Overrides carry
 * no currency and are stored in base currency; salary records are converted
 * with their rateUsed. A job outside its start/end months earns nothing.
 */
export function salaryForMonth(job: JobIncomeData, year: number, month: number): {
  gross: Decimal
  net: Decimal
  source: SalarySource
  record: SalaryRecordData | OverrideData | null
} {
  if (!isJobActiveInMonth(job, year, month)) return { gross: ZERO, net: ZERO, source: 'inactive', record: null }

  const taxCardDate = monthStartUTC(year, month)
  const override = job.overrides.find((o) => o.year === year && o.month === month)
  if (override) {
    const gross = dec(override.grossAmount)
    const net = recalculatedNet(job, override.deductionsSource, gross, taxCardDate) ?? dec(override.netAmount)
    return { gross, net, source: 'override', record: override }
  }

  const salary = salaryRecordForMonth(job.salaryRecords, year, month)
  if (!salary) return { gross: ZERO, net: ZERO, source: 'none', record: null }

  const rate = rateOf(salary.rateUsed)
  const grossOriginal = dec(salary.grossAmount)
  const netOriginal = recalculatedNet(job, salary.deductionsSource, grossOriginal, taxCardDate) ?? dec(salary.netAmount)
  return { gross: grossOriginal.mul(rate), net: netOriginal.mul(rate), source: 'salary', record: salary }
}

// ── Bonuses ───────────────────────────────────────────────────────────────────

/**
 * A bonus only counts when it is paid in a month the job is active, so planned
 * bonuses of a job that has ended drop out.
 */
function isBonusEligible(job: JobIncomeData, bonus: BonusData): boolean {
  const pay = yearMonthOfStoredDate(bonus.paymentDate)
  return isJobActiveInMonth(job, pay.year, pay.month)
}

/** Bonus amounts converted to base currency with the bonus's rateUsed. */
function bonusInBase(bonus: BonusData): { gross: Decimal; net: Decimal } {
  const rate = rateOf(bonus.rateUsed)
  return { gross: dec(bonus.grossAmount).mul(rate), net: dec(bonus.netAmount).mul(rate) }
}

/** Bonus contributions to one month under the given counting rule. */
export function bonusesForMonth(job: JobIncomeData, year: number, month: number, counting: BonusCounting = 'budget'): BonusContribution[] {
  if (counting === 'none') return []
  const out: BonusContribution[] = []
  for (const bonus of job.bonuses) {
    if (!isBonusEligible(job, bonus)) continue
    const pay = yearMonthOfStoredDate(bonus.paymentDate)
    const inPaymentMonth = pay.year === year && pay.month === month
    const { gross, net } = bonusInBase(bonus)

    if (counting === 'cash') {
      if (inPaymentMonth) out.push({ bonusId: bonus.id, label: bonus.label, gross, net })
      continue
    }

    if (!bonus.includeInBudget) continue
    if (bonus.budgetMode === 'SPREAD_ANNUALLY') {
      if (pay.year === year) out.push({ bonusId: bonus.id, label: bonus.label, gross: gross.div(TWELVE), net: net.div(TWELVE) })
    } else if (inPaymentMonth) {
      // ONE_OFF, or included without a mode: the full amount in the payment month
      out.push({ bonusId: bonus.id, label: bonus.label, gross, net })
    }
  }
  return out
}

/**
 * Monthly average of the budget-included bonuses paid in a calendar year.
 * Both ONE_OFF and SPREAD_ANNUALLY count as amount / 12 here — this is the
 * bonus part of a budget year's monthly income (a yearly average, like the
 * expenses' monthlyEquivalent).
 */
export function bonusMonthlyAverageForYear(job: JobIncomeData, year: number): { gross: Decimal; net: Decimal } {
  let gross = ZERO
  let net = ZERO
  for (const bonus of job.bonuses) {
    if (!bonus.includeInBudget) continue
    if (!isBonusEligible(job, bonus)) continue
    if (yearMonthOfStoredDate(bonus.paymentDate).year !== year) continue
    const b = bonusInBase(bonus)
    gross = gross.plus(b.gross)
    net = net.plus(b.net)
  }
  return { gross: gross.div(TWELVE), net: net.div(TWELVE) }
}

// ── Monthly income ────────────────────────────────────────────────────────────

/**
 * A job's income for one calendar month in base currency: salary (or the
 * month's override) plus bonuses under the given counting rule.
 */
export function monthlyIncomeForJob(job: JobIncomeData, year: number, month: number, counting: BonusCounting = 'budget'): MonthlyJobIncome {
  const salary = salaryForMonth(job, year, month)
  const bonuses = bonusesForMonth(job, year, month, counting)
  const bonusGross = bonuses.reduce((s, b) => s.plus(b.gross), ZERO)
  const bonusNet = bonuses.reduce((s, b) => s.plus(b.net), ZERO)
  return {
    gross: salary.gross.plus(bonusGross),
    net: salary.net.plus(bonusNet),
    salaryGross: salary.gross,
    salaryNet: salary.net,
    bonusGross,
    bonusNet,
    bonuses,
    active: salary.source !== 'inactive',
    source: salary.source,
    record: salary.record,
  }
}

export interface BudgetYearBasis {
  year: number
  status: string
}

export interface BudgetMonthlyIncome {
  gross: Decimal
  net: Decimal
  salaryGross: Decimal
  salaryNet: Decimal
  bonusGross: Decimal
  bonusNet: Decimal
}

/**
 * A job's monthly income for a budget year, in base currency.
 *
 *  - RETIRED years: the average of the twelve months of that year (salary
 *    changes, job start/end and bonuses as they actually fell).
 *  - ACTIVE / FUTURE / SIMULATION years: salary at the reference month (see
 *    getIncomeReferenceDate) plus the yearly average of the budget-included
 *    bonuses paid in the budget year.
 *
 * In both cases a bonus contributes amount / 12 regardless of its mode.
 */
export function budgetMonthlyIncomeForJob(job: JobIncomeData, budgetYear: BudgetYearBasis, ref: YearMonth): BudgetMonthlyIncome {
  if (budgetYear.status === 'RETIRED') {
    let salaryGross = ZERO
    let salaryNet = ZERO
    for (let m = 1; m <= 12; m++) {
      const s = salaryForMonth(job, budgetYear.year, m)
      salaryGross = salaryGross.plus(s.gross)
      salaryNet = salaryNet.plus(s.net)
    }
    salaryGross = salaryGross.div(TWELVE)
    salaryNet = salaryNet.div(TWELVE)
    const bonus = bonusMonthlyAverageForYear(job, budgetYear.year)
    return {
      gross: salaryGross.plus(bonus.gross),
      net: salaryNet.plus(bonus.net),
      salaryGross,
      salaryNet,
      bonusGross: bonus.gross,
      bonusNet: bonus.net,
    }
  }

  const salary = salaryForMonth(job, ref.year, ref.month)
  const bonus = bonusMonthlyAverageForYear(job, budgetYear.year)
  return {
    gross: salary.gross.plus(bonus.gross),
    net: salary.net.plus(bonus.net),
    salaryGross: salary.gross,
    salaryNet: salary.net,
    bonusGross: bonus.gross,
    bonusNet: bonus.net,
  }
}

// ── Income history ────────────────────────────────────────────────────────────

export type HistoryGranularity = 'monthly' | 'quarterly' | 'yearly'

export interface HistoryJob extends JobIncomeData {
  name: string
}

export interface HistoryBucket {
  period: string
  gross: number
  net: number
  total: number
  perJob: { jobId: string; jobName: string; gross: number; net: number }[]
  bonuses: { jobId: string; label: string; gross: number; net: number }[]
}

function periodLabel(year: number, month: number, granularity: HistoryGranularity): string {
  if (granularity === 'monthly') return `${year}-${String(month).padStart(2, '0')}`
  if (granularity === 'quarterly') return `${year}-Q${Math.ceil(month / 3)}`
  return `${year}`
}

function money(d: Decimal): number {
  return d.toDecimalPlaces(2).toNumber()
}

/**
 * Income history buckets from `from` to `to` (inclusive months). Each bucket
 * sums every month in range that falls in its period, so a quarterly bucket
 * is the quarter's total and a yearly bucket the year's total. Bonuses use
 * budget counting (SPREAD_ANNUALLY ÷12 per month, ONE_OFF in its month).
 */
export function buildIncomeHistory(jobs: HistoryJob[], from: YearMonth, to: YearMonth, granularity: HistoryGranularity): HistoryBucket[] {
  type Acc = {
    period: string
    gross: Decimal
    net: Decimal
    perJob: Map<string, { jobId: string; jobName: string; gross: Decimal; net: Decimal }>
    bonuses: Map<string, { jobId: string; label: string; gross: Decimal; net: Decimal }>
  }
  const buckets: Acc[] = []
  const last = monthIndex(to.year, to.month)

  for (let idx = monthIndex(from.year, from.month); idx <= last; idx++) {
    const year = Math.floor(idx / 12)
    const month = (idx % 12) + 1
    const period = periodLabel(year, month, granularity)
    let bucket = buckets[buckets.length - 1]
    if (!bucket || bucket.period !== period) {
      bucket = { period, gross: ZERO, net: ZERO, perJob: new Map(), bonuses: new Map() }
      buckets.push(bucket)
    }

    for (const job of jobs) {
      const income = monthlyIncomeForJob(job, year, month, 'budget')
      if (income.active) {
        const pj = bucket.perJob.get(job.id) ?? { jobId: job.id, jobName: job.name, gross: ZERO, net: ZERO }
        pj.gross = pj.gross.plus(income.salaryGross)
        pj.net = pj.net.plus(income.salaryNet)
        bucket.perJob.set(job.id, pj)
      }
      for (const b of income.bonuses) {
        const eb = bucket.bonuses.get(b.bonusId) ?? { jobId: job.id, label: b.label, gross: ZERO, net: ZERO }
        eb.gross = eb.gross.plus(b.gross)
        eb.net = eb.net.plus(b.net)
        bucket.bonuses.set(b.bonusId, eb)
      }
      bucket.gross = bucket.gross.plus(income.gross)
      bucket.net = bucket.net.plus(income.net)
    }
  }

  return buckets.map((b) => ({
    period: b.period,
    gross: money(b.gross),
    net: money(b.net),
    total: money(b.net),
    perJob: [...b.perJob.values()].map((j) => ({ jobId: j.jobId, jobName: j.jobName, gross: money(j.gross), net: money(j.net) })),
    bonuses: [...b.bonuses.values()]
      .filter((x) => x.gross.gt(0) || x.net.gt(0))
      .map((x) => ({ jobId: x.jobId, label: x.label, gross: money(x.gross), net: money(x.net) })),
  }))
}
