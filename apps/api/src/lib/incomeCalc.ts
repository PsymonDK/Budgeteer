import { prisma } from './prisma'
import { BudgetStatus } from '@prisma/client'

export interface MemberIncome {
  userId: string
  monthlyAllocatedGross: number
  monthlyAllocatedNet: number
}

/**
 * Returns the gross and net monthly income for a job at a given reference date.
 * Checks MonthlyIncomeOverride first; falls back to the latest SalaryRecord.
 */
export async function getJobMonthlyIncome(jobId: string, atDate: Date): Promise<{ gross: number; net: number }> {
  const year = atDate.getFullYear()
  const month = atDate.getMonth() + 1 // 1-12

  const override = await prisma.monthlyIncomeOverride.findUnique({
    where: { jobId_year_month: { jobId, year, month } },
  })
  if (override) return {
    gross: parseFloat(override.grossAmount.toString()),
    net: parseFloat(override.netAmount.toString()),
  }

  const salary = await prisma.salaryRecord.findFirst({
    where: { jobId, effectiveFrom: { lte: atDate } },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!salary) return { gross: 0, net: 0 }
  const rate = salary.rateUsed ? parseFloat(salary.rateUsed.toString()) : 1
  return {
    gross: parseFloat(salary.grossAmount.toString()) * rate,
    net: parseFloat(salary.netAmount.toString()) * rate,
  }
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
 * Returns total monthly gross/net income allocated to a budget year, at a reference date.
 * Groups by userId for per-member breakdown. Split percentages should be based on gross.
 */
export async function calcIncomeForYear(
  budgetYearId: string,
  referenceDate: Date
): Promise<{ totalMonthlyGross: number; totalMonthlyNet: number; members: MemberIncome[] }> {
  const allocations = await prisma.householdIncomeAllocation.findMany({
    where: { budgetYearId },
    include: { job: { select: { userId: true } } },
  })

  const memberGrossMap = new Map<string, number>()
  const memberNetMap = new Map<string, number>()

  await Promise.all(
    allocations.map(async (alloc) => {
      const { gross, net } = await getJobMonthlyIncome(alloc.jobId, referenceDate)
      const pct = parseFloat(alloc.allocationPct.toString()) / 100
      const userId = alloc.job.userId
      memberGrossMap.set(userId, (memberGrossMap.get(userId) ?? 0) + gross * pct)
      memberNetMap.set(userId, (memberNetMap.get(userId) ?? 0) + net * pct)
    })
  )

  const members: MemberIncome[] = [...memberGrossMap.keys()].map((userId) => ({
    userId,
    monthlyAllocatedGross: memberGrossMap.get(userId) ?? 0,
    monthlyAllocatedNet: memberNetMap.get(userId) ?? 0,
  }))

  const totalMonthlyGross = members.reduce((s, m) => s + m.monthlyAllocatedGross, 0)
  const totalMonthlyNet = members.reduce((s, m) => s + m.monthlyAllocatedNet, 0)
  return { totalMonthlyGross, totalMonthlyNet, members }
}
