import { prisma } from './prisma'
import { calcForwardMonthlyNeed } from './calculations'

export async function recalculateTransfer(budgetYearId: string): Promise<void> {
  const budgetYear = await prisma.budgetYear.findUnique({ where: { id: budgetYearId } })
  if (!budgetYear || budgetYear.status !== 'ACTIVE') return

  const targetMonth = new Date().getMonth() + 1 // 1-12
  const year = budgetYear.year

  const expenses = await prisma.expense.findMany({
    where: { budgetYearId },
    select: { monthlyEquivalent: true },
  })

  const paidTransfers = await prisma.budgetTransfer.findMany({
    where: { budgetYearId, status: { in: ['PAID', 'ADJUSTED'] } },
    select: { actualAmount: true },
  })

  const calculatedAmount = calcForwardMonthlyNeed(expenses, paidTransfers, targetMonth)

  const existing = await prisma.budgetTransfer.findUnique({
    where: { budgetYearId_month_year: { budgetYearId, month: targetMonth, year } },
  })

  if (!existing || existing.status === 'PENDING') {
    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: targetMonth, year } },
      create: { budgetYearId, year, month: targetMonth, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  } else {
    // Current month is PAID/ADJUSTED — write to next month's row instead
    const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1
    const nextYear = targetMonth === 12 ? year + 1 : year
    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: nextMonth, year: nextYear } },
      create: { budgetYearId, year: nextYear, month: nextMonth, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}
