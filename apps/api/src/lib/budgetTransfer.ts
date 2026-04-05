import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import { calcForwardMonthlyNeed, calcOccurrenceScheduledAmount, activeMonthCount } from './calculations'

export async function recalculateTransfer(budgetYearId: string): Promise<void> {
  const budgetYear = await prisma.budgetYear.findUnique({
    where: { id: budgetYearId },
    include: { household: { select: { budgetModel: true } } },
  })
  if (!budgetYear || budgetYear.status !== 'ACTIVE') return

  const { budgetModel } = budgetYear.household
  const currentMonth = new Date().getMonth() + 1
  const year = budgetYear.year

  const expenses = await prisma.expense.findMany({
    where: { budgetYearId },
    select: { id: true, monthlyEquivalent: true, startMonth: true, endMonth: true },
  })

  const existingTransfers = await prisma.budgetTransfer.findMany({ where: { budgetYearId } })
  const byMonth = new Map(existingTransfers.map((t) => [t.month, t]))

  if (budgetModel === 'PAY_NO_PAY') {
    await recalculatePayNoPay(budgetYearId, year, currentMonth, expenses, byMonth)
    return
  }

  const annualNeed = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString()).mul(12)),
    new Decimal(0),
  )
  const perMonth = annualNeed.div(12)

  if (budgetModel === 'FORWARD_LOOKING') {
    await recalculateForwardLooking(budgetYearId, year, currentMonth, expenses, byMonth, perMonth)
    return
  }

  // AVERAGE: equal split across all 12 months, clear any stale forwardMonthlyEquivalent values
  await prisma.expense.updateMany({
    where: { budgetYearId, NOT: { forwardMonthlyEquivalent: null } },
    data: { forwardMonthlyEquivalent: null },
  })

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount: perMonth, calculatedAt: new Date() },
      update: { calculatedAmount: perMonth, calculatedAt: new Date() },
    })
  }
}

async function recalculateForwardLooking(
  budgetYearId: string,
  year: number,
  currentMonth: number,
  expenses: { id: string; monthlyEquivalent: Decimal; startMonth: number | null; endMonth: number | null }[],
  byMonth: Map<number, { status: string }>,
  perMonth: Decimal,
): Promise<void> {
  const forwardAmount = calcForwardMonthlyNeed(expenses, currentMonth)
  const remainingMonths = 13 - currentMonth

  // Write each expense's per-active-month share of the forward need to forwardMonthlyEquivalent.
  // Uses the same per-expense decomposition as calcForwardMonthlyNeed so that SUM equals forwardAmount.
  await Promise.all(
    expenses.map((e) => {
      let fwd: Decimal
      if (remainingMonths <= 0) {
        fwd = new Decimal(0)
      } else {
        const start = Math.max(e.startMonth ?? 1, currentMonth)
        const end = e.endMonth ?? 12
        if (start > end) {
          fwd = new Decimal(0) // expense ended before current month
        } else {
          const activeRemaining = end - start + 1
          const totalMonths = activeMonthCount(e.startMonth, e.endMonth)
          const monthlyWhenActive = new Decimal(e.monthlyEquivalent.toString()).mul(12).div(totalMonths)
          fwd = monthlyWhenActive.mul(activeRemaining).div(remainingMonths)
        }
      }
      return prisma.expense.update({ where: { id: e.id }, data: { forwardMonthlyEquivalent: fwd } })
    }),
  )

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue

    const calculatedAmount = m < currentMonth ? perMonth : forwardAmount

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}

async function recalculatePayNoPay(
  budgetYearId: string,
  year: number,
  currentMonth: number,
  expenses: { id: string; monthlyEquivalent: Decimal; startMonth: number | null; endMonth: number | null }[],
  byMonth: Map<number, { status: string }>,
): Promise<void> {
  // Seed occurrences for the current month through end of year so that all remaining
  // months have amounts rather than showing 0 (e.g. after switching to PAY_NO_PAY).
  for (let m = currentMonth; m <= 12; m++) {
    await seedCurrentMonthOccurrences(budgetYearId, year, m, expenses)
  }

  // Aggregate PENDING obligations per month from occurrence tables
  const [expOccs, savOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId }, year, status: 'PENDING' },
      select: { month: true, scheduledAmount: true, carriedAmount: true },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId }, year, status: 'PENDING' },
      select: { month: true, scheduledAmount: true, carriedAmount: true },
    }),
  ])

  const occByMonth = new Map<number, Decimal>()
  for (const occ of [...expOccs, ...savOccs]) {
    const prev = occByMonth.get(occ.month) ?? new Decimal(0)
    occByMonth.set(
      occ.month,
      prev
        .add(new Decimal(occ.scheduledAmount.toString()))
        .add(new Decimal(occ.carriedAmount.toString())),
    )
  }

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue

    const calculatedAmount = occByMonth.get(m) ?? new Decimal(0)

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}

/** Creates occurrence rows for the current month for any expense/savings entry that lacks one. */
async function seedCurrentMonthOccurrences(
  budgetYearId: string,
  year: number,
  month: number,
  expenses: { id: string; monthlyEquivalent: Decimal; startMonth: number | null; endMonth: number | null }[],
): Promise<void> {
  const [existingExpOccs, savingsEntries, existingSavOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expenseId: { in: expenses.map((e) => e.id) }, year, month },
      select: { expenseId: true },
    }),
    prisma.savingsEntry.findMany({
      where: { budgetYearId },
      select: { id: true, monthlyEquivalent: true },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId }, year, month },
      select: { savingsEntryId: true },
    }),
  ])

  const existingExpIds = new Set(existingExpOccs.map((o) => o.expenseId))
  const existingSavIds = new Set(existingSavOccs.map((o) => o.savingsEntryId))

  const newExpOccs = expenses
    .filter((e) => !existingExpIds.has(e.id))
    .flatMap((e) => {
      const scheduledAmount = calcOccurrenceScheduledAmount(e, month)
      if (scheduledAmount === null) return []
      return [{ expenseId: e.id, year, month, scheduledAmount, carriedAmount: new Decimal(0) }]
    })

  const newSavOccs = savingsEntries
    .filter((s) => !existingSavIds.has(s.id))
    .map((s) => ({
      savingsEntryId: s.id,
      year,
      month,
      scheduledAmount: new Decimal(s.monthlyEquivalent.toString()),
      carriedAmount: new Decimal(0),
    }))

  await Promise.all([
    newExpOccs.length > 0 ? prisma.expenseOccurrence.createMany({ data: newExpOccs }) : Promise.resolve(),
    newSavOccs.length > 0 ? prisma.savingsOccurrence.createMany({ data: newSavOccs }) : Promise.resolve(),
  ])
}

/**
 * Called at month rollover for PAY_NO_PAY households.
 * Closes all PENDING occurrences from the closing month (marks them SKIPPED),
 * then opens occurrence rows for the new month — carrying over any unpaid balances.
 */
export async function rolloverPayNoPayOccurrences(
  budgetYearId: string,
  year: number,
  closingMonth: number,
  openingMonth: number,
): Promise<void> {
  // 1. Find PENDING occurrences from the closing month
  const [pendingExpOccs, pendingSavOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId }, year, month: closingMonth, status: 'PENDING' },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId }, year, month: closingMonth, status: 'PENDING' },
    }),
  ])

  // 2. Mark them SKIPPED
  await Promise.all([
    pendingExpOccs.length > 0
      ? prisma.expenseOccurrence.updateMany({
          where: { id: { in: pendingExpOccs.map((o) => o.id) } },
          data: { status: 'SKIPPED' },
        })
      : Promise.resolve(),
    pendingSavOccs.length > 0
      ? prisma.savingsOccurrence.updateMany({
          where: { id: { in: pendingSavOccs.map((o) => o.id) } },
          data: { status: 'SKIPPED' },
        })
      : Promise.resolve(),
  ])

  // 3. Build carry-over maps: unpaid balance = scheduledAmount + carriedAmount - (actualAmount ?? 0)
  const expenseCarryMap = new Map<string, Decimal>()
  for (const occ of pendingExpOccs) {
    const unpaid = new Decimal(occ.scheduledAmount.toString())
      .add(new Decimal(occ.carriedAmount.toString()))
      .sub(occ.actualAmount ? new Decimal(occ.actualAmount.toString()) : new Decimal(0))
    if (unpaid.gt(0)) expenseCarryMap.set(occ.expenseId, unpaid)
  }

  const savingsCarryMap = new Map<string, Decimal>()
  for (const occ of pendingSavOccs) {
    const unpaid = new Decimal(occ.scheduledAmount.toString())
      .add(new Decimal(occ.carriedAmount.toString()))
      .sub(occ.actualAmount ? new Decimal(occ.actualAmount.toString()) : new Decimal(0))
    if (unpaid.gt(0)) savingsCarryMap.set(occ.savingsEntryId, unpaid)
  }

  // 4. Fetch all expenses and savings entries for the budget year
  const [expenses, savingsEntries] = await Promise.all([
    prisma.expense.findMany({
      where: { budgetYearId },
      select: { id: true, monthlyEquivalent: true, startMonth: true, endMonth: true },
    }),
    prisma.savingsEntry.findMany({
      where: { budgetYearId },
      select: { id: true, monthlyEquivalent: true },
    }),
  ])

  // 5. Upsert opening month occurrences (create fresh or merge carry into existing)
  await Promise.all([
    ...expenses.map(async (expense) => {
      const scheduledAmount = calcOccurrenceScheduledAmount(expense, openingMonth)
      const carriedAmount = expenseCarryMap.get(expense.id) ?? new Decimal(0)
      if (scheduledAmount === null && carriedAmount.eq(0)) return
      await prisma.expenseOccurrence.upsert({
        where: { expenseId_year_month: { expenseId: expense.id, year, month: openingMonth } },
        create: {
          expenseId: expense.id,
          year,
          month: openingMonth,
          scheduledAmount: scheduledAmount ?? new Decimal(0),
          carriedAmount,
        },
        update: { carriedAmount },
      })
    }),
    ...savingsEntries.map(async (entry) => {
      const carriedAmount = savingsCarryMap.get(entry.id) ?? new Decimal(0)
      await prisma.savingsOccurrence.upsert({
        where: { savingsEntryId_year_month: { savingsEntryId: entry.id, year, month: openingMonth } },
        create: {
          savingsEntryId: entry.id,
          year,
          month: openingMonth,
          scheduledAmount: new Decimal(entry.monthlyEquivalent.toString()),
          carriedAmount,
        },
        update: { carriedAmount },
      })
    }),
  ])
}
