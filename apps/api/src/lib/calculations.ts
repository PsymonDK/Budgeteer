import { Frequency } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

export function calcMonthlyEquivalent(amount: Decimal, frequency: Frequency): Decimal {
  const a = new Decimal(amount.toString())
  switch (frequency) {
    case 'WEEKLY':      return a.mul(52).div(12)
    case 'FORTNIGHTLY': return a.mul(26).div(12)
    case 'MONTHLY':     return a
    case 'QUARTERLY':   return a.div(3)
    case 'BIANNUAL':    return a.div(6)
    case 'ANNUAL':      return a.div(12)
  }
}

/**
 * Returns the number of active months an expense covers within a year.
 * If neither bound is set, returns 12.
 */
export function activeMonthCount(startMonth: number | null, endMonth: number | null): number {
  const start = startMonth ?? 1
  const end = endMonth ?? 12
  return Math.max(0, end - start + 1)
}

/**
 * Adjusts a monthly equivalent to reflect a partial-year expense.
 * monthlyEquivalent is the per-period cost; this returns the annual average (÷12).
 * For a full-year expense both bounds are null → no adjustment.
 */
export function calcAnnualAverage(monthlyEquivalent: Decimal, startMonth: number | null, endMonth: number | null): Decimal {
  const months = activeMonthCount(startMonth, endMonth)
  if (months === 12) return monthlyEquivalent
  return new Decimal(monthlyEquivalent.toString()).mul(months).div(12)
}

/**
 * Calculates the recommended transfer amount for a given target month.
 * Formula: max(0, (annualNeed - alreadyPaid) / remainingMonths)
 * where remainingMonths = 13 - targetMonth
 */
export function calcForwardMonthlyNeed(
  expenses: { monthlyEquivalent: Decimal }[],
  paidTransfers: { actualAmount: Decimal | null }[],
  targetMonth: number, // 1-12
): Decimal {
  const annualNeed = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString()).mul(12)),
    new Decimal(0),
  )
  const alreadyPaid = paidTransfers.reduce(
    (sum, t) => sum.add(t.actualAmount ? new Decimal(t.actualAmount.toString()) : new Decimal(0)),
    new Decimal(0),
  )
  const remaining = annualNeed.sub(alreadyPaid)
  if (remaining.lte(0)) return new Decimal(0)
  const remainingMonths = new Decimal(13 - targetMonth)
  return remaining.div(remainingMonths)
}

export function deriveBudgetStatus(year: number): 'ACTIVE' | 'FUTURE' | 'RETIRED' {
  const current = new Date().getFullYear()
  if (year < current) return 'RETIRED'
  if (year === current) return 'ACTIVE'
  return 'FUTURE'
}
