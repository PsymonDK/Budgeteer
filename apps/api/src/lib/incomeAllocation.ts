/**
 * Per-budget-year evaluation of a user's household income allocations.
 *
 * Allocation is a % per job per budget year, so it must be summed per
 * calendar year: 100% in 2026 plus 100% in 2027 is two fully allocated years,
 * not 200%. Only live (ACTIVE / FUTURE) years are considered; retired years
 * are history and simulations are hypothetical.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { pickDefaultBudgetYear } from './budgetYearSelection'

const ZERO = new Decimal(0)
const HUNDRED = new Decimal(100)
const LIVE_STATUSES = new Set(['ACTIVE', 'FUTURE'])

export interface AllocationYearRow {
  jobId: string
  allocationPct: Decimal
  budgetYear: { year: number; status: string }
}

export interface OverAllocation {
  jobId: string
  year: number
  totalPct: Decimal
}

function liveRows<T extends AllocationYearRow>(rows: T[]): T[] {
  return rows.filter((r) => LIVE_STATUSES.has(r.budgetYear.status))
}

/** calendar year -> jobId -> summed allocation % across households */
export function allocationPctByYear(rows: AllocationYearRow[]): Map<number, Map<string, Decimal>> {
  const byYear = new Map<number, Map<string, Decimal>>()
  for (const r of liveRows(rows)) {
    const jobs = byYear.get(r.budgetYear.year) ?? new Map<string, Decimal>()
    jobs.set(r.jobId, (jobs.get(r.jobId) ?? ZERO).plus(r.allocationPct.toString()))
    byYear.set(r.budgetYear.year, jobs)
  }
  return byYear
}

/** Jobs whose allocations in a single calendar year add up to more than 100%. */
export function findOverAllocations(rows: AllocationYearRow[]): OverAllocation[] {
  const out: OverAllocation[] = []
  for (const [year, jobs] of allocationPctByYear(rows)) {
    for (const [jobId, totalPct] of jobs) {
      if (totalPct.gt(HUNDRED)) out.push({ jobId, year, totalPct })
    }
  }
  return out.sort((a, b) => a.year - b.year || a.jobId.localeCompare(b.jobId))
}

/**
 * The budget year that summary figures report on: the earliest ACTIVE year,
 * else the earliest FUTURE year, among the years the rows touch.
 */
export function pickReportingYear<T extends AllocationYearRow>(rows: T[]): T['budgetYear'] | null {
  return pickDefaultBudgetYear(liveRows(rows).map((r) => r.budgetYear))
}

/**
 * Allocated share of a user's income for one calendar year.
 * @param incomeByJobId monthly income per job (all the user's jobs)
 */
export function summarizeAllocatedIncome(
  rows: AllocationYearRow[],
  year: number,
  incomeByJobId: Map<string, Decimal>,
): { totalMonthly: Decimal; totalAllocated: Decimal; totalUnallocated: Decimal; allocationPct: Decimal } {
  const totalMonthly = [...incomeByJobId.values()].reduce((s, v) => s.plus(v), ZERO)
  const pctByJob = allocationPctByYear(rows).get(year) ?? new Map<string, Decimal>()
  let totalAllocated = ZERO
  for (const [jobId, pct] of pctByJob) {
    const income = incomeByJobId.get(jobId) ?? ZERO
    totalAllocated = totalAllocated.plus(income.mul(pct).div(HUNDRED))
  }
  const allocationPct = totalMonthly.gt(0) ? totalAllocated.div(totalMonthly).mul(HUNDRED) : ZERO
  return { totalMonthly, totalAllocated, totalUnallocated: totalMonthly.minus(totalAllocated), allocationPct }
}
