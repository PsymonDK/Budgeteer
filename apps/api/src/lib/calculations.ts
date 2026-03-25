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

export function deriveBudgetStatus(year: number): 'ACTIVE' | 'FUTURE' | 'RETIRED' {
  const current = new Date().getFullYear()
  if (year < current) return 'RETIRED'
  if (year === current) return 'ACTIVE'
  return 'FUTURE'
}
