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
    select: { monthlyEquivalent: true },
  })

  const annualNeed = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString()).mul(12)),
    new Decimal(0),
  )
  const perMonth = annualNeed.div(12)

  const existingTransfers = await prisma.budgetTransfer.findMany({ where: { budgetYearId } })
  const byMonth = new Map(existingTransfers.map((t) => [t.month, t]))
  const paidTransfers = existingTransfers.filter((t) => t.status === 'PAID' || t.status === 'ADJUSTED')

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)

    // Never overwrite locked months
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue

    let calculatedAmount: Decimal
    if (m < currentMonth) {
      // Past months: show the equal-split planned amount
      calculatedAmount = perMonth
    } else {
      // Current and future months: forward-looking formula
      calculatedAmount = calcForwardMonthlyNeed(expenses, paidTransfers, m)
    }

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}
