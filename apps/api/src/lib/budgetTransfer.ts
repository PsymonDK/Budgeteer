import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import { calcForwardMonthlyNeed } from './calculations'

export async function recalculateTransfer(budgetYearId: string): Promise<void> {
  const budgetYear = await prisma.budgetYear.findUnique({ where: { id: budgetYearId } })
  if (!budgetYear || budgetYear.status !== 'ACTIVE') return

  const currentMonth = new Date().getMonth() + 1
  const year = budgetYear.year

  const expenses = await prisma.expense.findMany({
    where: { budgetYearId },
    select: { monthlyEquivalent: true, startMonth: true, endMonth: true },
  })

  const annualNeed = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString()).mul(12)),
    new Decimal(0),
  )
  const perMonth = annualNeed.div(12)

  const existingTransfers = await prisma.budgetTransfer.findMany({ where: { budgetYearId } })
  const byMonth = new Map(existingTransfers.map((t) => [t.month, t]))

  // Forward amount is purely based on remaining expenses from currentMonth onwards.
  // No deficit carry-over from past months — past transfers (paid or pending) are irrelevant.
  const forwardAmount = calcForwardMonthlyNeed(expenses, currentMonth)

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)

    // Never overwrite locked months
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue

    let calculatedAmount: Decimal
    if (m < currentMonth) {
      // Past months: show the equal-split planned amount
      calculatedAmount = perMonth
    } else {
      // Current and future months: same forward-looking amount for a consistent plan
      calculatedAmount = forwardAmount
    }

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}
