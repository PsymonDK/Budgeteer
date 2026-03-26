import { prisma } from './prisma'
import { BudgetStatus } from '@prisma/client'

export interface MemberIncome {
  userId: string
  monthlyAllocated: number
}

/**
 * Returns the net monthly income for a job at a given reference date.
 * Checks MonthlyIncomeOverride first; falls back to the latest SalaryRecord.
 */
export async function getJobMonthlyIncome(jobId: string, atDate: Date): Promise<number> {
  const year = atDate.getFullYear()
  const month = atDate.getMonth() + 1 // 1-12

  const override = await prisma.monthlyIncomeOverride.findUnique({
    where: { jobId_year_month: { jobId, year, month } },
  })
  if (override) return parseFloat(override.netAmount.toString())

  const salary = await prisma.salaryRecord.findFirst({
    where: { jobId, effectiveFrom: { lte: atDate } },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!salary) return 0
  const net = parseFloat(salary.netAmount.toString())
  const rate = salary.rateUsed ? parseFloat(salary.rateUsed.toString()) : 1
  return net * rate
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

/**
 * Returns total monthly income allocated to a budget year, at a reference date.
 * Groups by userId for per-member breakdown.
 */
export async function calcIncomeForYear(
  budgetYearId: string,
  referenceDate: Date
): Promise<{ totalMonthly: number; members: MemberIncome[] }> {
  const allocations = await prisma.householdIncomeAllocation.findMany({
    where: { budgetYearId },
    include: { job: { select: { userId: true } } },
  })

  const memberMap = new Map<string, number>()

  await Promise.all(
    allocations.map(async (alloc) => {
      const monthly = await getJobMonthlyIncome(alloc.jobId, referenceDate)
      const allocated = monthly * parseFloat(alloc.allocationPct.toString()) / 100
      const prev = memberMap.get(alloc.job.userId) ?? 0
      memberMap.set(alloc.job.userId, prev + allocated)
    })
  )

  const members: MemberIncome[] = [...memberMap.entries()].map(([userId, monthlyAllocated]) => ({
    userId,
    monthlyAllocated,
  }))

  const totalMonthly = members.reduce((s, m) => s + m.monthlyAllocated, 0)
  return { totalMonthly, members }
}
