import { prisma } from './prisma'
import { BudgetStatus } from '@prisma/client'
import { toNum } from './decimal'
import { calcDanishDeductions } from './taxCalcDK'

export interface MemberIncome {
  userId: string
  monthlyAllocatedGross: number
  monthlyAllocatedNet: number
}

/**
 * When deductionsSource is null (reset by the payslip-lines migration because the old
 * algorithm was buggy) and the job is DK with an active TaxCardSettings at atDate,
 * recalculate net from the tax card so the correct value is returned.
 * Returns null when the stored netAmount should be used as-is.
 */
async function resolveCalculatedNet(
  jobId: string,
  grossOriginal: number,
  deductionsSource: string | null,
  atDate: Date,
): Promise<number | null> {
  if (deductionsSource !== null) return null // correctly stored after migration — trust it

  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { country: true } })
  if (job?.country !== 'DK') return null

  const taxCard = await prisma.taxCardSettings.findFirst({
    where: { jobId, effectiveFrom: { lte: atDate } },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!taxCard) return null

  const calc = calcDanishDeductions(grossOriginal, {
    traekprocent: toNum(taxCard.traekprocent),
    personfradragMonthly: toNum(taxCard.personfradragMonthly),
    pensionEmployeePct: taxCard.pensionEmployeePct != null ? toNum(taxCard.pensionEmployeePct) : null,
    pensionEmployerPct: taxCard.pensionEmployerPct != null ? toNum(taxCard.pensionEmployerPct) : null,
    atpAmount: taxCard.atpAmount != null ? toNum(taxCard.atpAmount) : null,
    bruttoItems: taxCard.bruttoItems as { label: string; monthlyAmount: number }[] | null,
  })
  return calc.net
}

/**
 * Returns the gross and net monthly income for a job at a given reference date.
 * Checks MonthlyIncomeOverride first; falls back to the latest SalaryRecord.
 *
 * When a record has deductionsSource = null (stale after the payslip-lines migration)
 * and the job is a DK job with a TaxCardSettings effective at atDate, the net is
 * recalculated on-the-fly using the correct Danish tax algorithm.
 */
export async function getJobMonthlyIncome(jobId: string, atDate: Date): Promise<{ gross: number; net: number }> {
  const year = atDate.getFullYear()
  const month = atDate.getMonth() + 1 // 1-12

  const override = await prisma.monthlyIncomeOverride.findUnique({
    where: { jobId_year_month: { jobId, year, month } },
  })
  if (override) {
    const gross = toNum(override.grossAmount)
    const recalcNet = await resolveCalculatedNet(jobId, gross, override.deductionsSource, atDate)
    return { gross, net: recalcNet ?? toNum(override.netAmount) }
  }

  const salary = await prisma.salaryRecord.findFirst({
    where: { jobId, effectiveFrom: { lte: atDate } },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!salary) return { gross: 0, net: 0 }
  const rate = salary.rateUsed ? toNum(salary.rateUsed) : 1
  const grossOriginal = toNum(salary.grossAmount)
  const gross = grossOriginal * rate
  const recalcNet = await resolveCalculatedNet(jobId, grossOriginal, salary.deductionsSource, atDate)
  return {
    gross,
    net: recalcNet !== null ? recalcNet * rate : toNum(salary.netAmount) * rate,
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
      const pct = toNum(alloc.allocationPct) / 100
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
