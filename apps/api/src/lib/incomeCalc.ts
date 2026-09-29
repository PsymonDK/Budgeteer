import { prisma, notDeleted } from './prisma'
import { BudgetStatus, Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  budgetMonthlyIncomeForJob,
  BudgetYearBasis,
  JobIncomeData,
  yearMonthOfLocalDate,
  YearMonth,
} from './jobIncome'

/**
 * Prisma include that loads everything the pure income functions in
 * jobIncome.ts need for a job, in one query.
 */
export const JOB_INCOME_INCLUDE = {
  salaryRecords: { where: notDeleted },
  overrides: { where: notDeleted },
  bonuses: { where: notDeleted },
  taxCardSettings: { where: notDeleted },
} satisfies Prisma.JobInclude

export type JobWithIncomeData = Prisma.JobGetPayload<{ include: typeof JOB_INCOME_INCLUDE }>

export interface MemberIncome {
  userId: string
  monthlyAllocatedGross: number
  monthlyAllocatedNet: number
}

/**
 * Returns the reference date to use for income calculations based on budget year status.
 */
export function getIncomeReferenceDate(year: number, status: BudgetStatus): Date {
  switch (status) {
    case 'FUTURE':
      return new Date(year, 0, 1) // January 1
    case 'RETIRED':
      return new Date(year, 11, 31) // December 31
    case 'ACTIVE':
    case 'SIMULATION':
    default:
      return new Date()
  }
}

// ── Pure aggregation ──────────────────────────────────────────────────────────

const ZERO = new Decimal(0)
const HUNDRED = new Decimal(100)

export interface AllocatedJobInput<J extends JobIncomeData = JobIncomeData> {
  job: J
  userId: string
  allocationPct: Decimal
}

export interface AllocatedJobIncome<J extends JobIncomeData = JobIncomeData> {
  job: J
  userId: string
  allocationPct: Decimal
  monthlyGross: Decimal
  monthlyNet: Decimal
  allocatedGross: Decimal
  allocatedNet: Decimal
}

export interface MemberIncomeDetailed {
  userId: string
  monthlyAllocatedGross: Decimal
  monthlyAllocatedNet: Decimal
}

export interface YearIncomeDetailed<J extends JobIncomeData = JobIncomeData> {
  totalMonthlyGross: Decimal
  totalMonthlyNet: Decimal
  members: MemberIncomeDetailed[]
  allocations: AllocatedJobIncome<J>[]
}

/**
 * Allocated monthly income for a budget year from preloaded allocations.
 * Each job's income comes from budgetMonthlyIncomeForJob (salary, overrides,
 * FX, start/end dates and bonuses), multiplied by its allocation %.
 */
export function aggregateAllocatedIncome<J extends JobIncomeData>(
  allocations: AllocatedJobInput<J>[],
  budgetYear: BudgetYearBasis,
  ref: YearMonth,
): YearIncomeDetailed<J> {
  const incomeCache = new Map<string, { gross: Decimal; net: Decimal }>()
  const rows: AllocatedJobIncome<J>[] = allocations.map((a) => {
    let income = incomeCache.get(a.job.id)
    if (!income) {
      income = budgetMonthlyIncomeForJob(a.job, budgetYear, ref)
      incomeCache.set(a.job.id, income)
    }
    const pct = new Decimal(a.allocationPct.toString())
    return {
      job: a.job,
      userId: a.userId,
      allocationPct: pct,
      monthlyGross: income.gross,
      monthlyNet: income.net,
      allocatedGross: income.gross.mul(pct).div(HUNDRED),
      allocatedNet: income.net.mul(pct).div(HUNDRED),
    }
  })

  const memberMap = new Map<string, MemberIncomeDetailed>()
  for (const r of rows) {
    const m = memberMap.get(r.userId) ?? { userId: r.userId, monthlyAllocatedGross: ZERO, monthlyAllocatedNet: ZERO }
    m.monthlyAllocatedGross = m.monthlyAllocatedGross.plus(r.allocatedGross)
    m.monthlyAllocatedNet = m.monthlyAllocatedNet.plus(r.allocatedNet)
    memberMap.set(r.userId, m)
  }
  const members = [...memberMap.values()]

  return {
    totalMonthlyGross: members.reduce((s, m) => s.plus(m.monthlyAllocatedGross), ZERO),
    totalMonthlyNet: members.reduce((s, m) => s.plus(m.monthlyAllocatedNet), ZERO),
    members,
    allocations: rows,
  }
}

// ── Database-backed wrappers ──────────────────────────────────────────────────

/**
 * Allocated monthly gross/net income for a budget year (Decimal), with
 * per-member and per-allocation breakdowns. Two queries regardless of the
 * number of allocations.
 */
export async function calcIncomeForYearDetailed(
  budgetYearId: string,
  referenceDate: Date,
): Promise<YearIncomeDetailed<JobWithIncomeData>> {
  const [budgetYear, allocations] = await Promise.all([
    prisma.budgetYear.findUnique({ where: { id: budgetYearId }, select: { year: true, status: true } }),
    prisma.householdIncomeAllocation.findMany({
      where: { budgetYearId },
      include: { job: { include: JOB_INCOME_INCLUDE } },
    }),
  ])
  if (!budgetYear) return { totalMonthlyGross: ZERO, totalMonthlyNet: ZERO, members: [], allocations: [] }

  return aggregateAllocatedIncome(
    allocations.map((a) => ({ job: a.job, userId: a.job.userId, allocationPct: a.allocationPct })),
    budgetYear,
    yearMonthOfLocalDate(referenceDate),
  )
}

/**
 * Returns total monthly gross/net income allocated to a budget year, at a reference date.
 * Groups by userId for per-member breakdown. Split percentages should be based on gross.
 * Bonuses are included as a yearly average (see budgetMonthlyIncomeForJob).
 */
export async function calcIncomeForYear(
  budgetYearId: string,
  referenceDate: Date
): Promise<{ totalMonthlyGross: number; totalMonthlyNet: number; members: MemberIncome[] }> {
  const detailed = await calcIncomeForYearDetailed(budgetYearId, referenceDate)
  return {
    totalMonthlyGross: detailed.totalMonthlyGross.toNumber(),
    totalMonthlyNet: detailed.totalMonthlyNet.toNumber(),
    members: detailed.members.map((m) => ({
      userId: m.userId,
      monthlyAllocatedGross: m.monthlyAllocatedGross.toNumber(),
      monthlyAllocatedNet: m.monthlyAllocatedNet.toNumber(),
    })),
  }
}
