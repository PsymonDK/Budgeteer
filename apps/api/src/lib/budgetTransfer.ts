import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import { calcForwardMonthlyNeed, calcOccurrenceScheduledAmount, activeMonthCount } from './calculations'

type ScheduleSource = { id: string; monthlyEquivalent: Decimal; startMonth: number | null; endMonth: number | null }

/**
 * The month (1-12) the budget year is "in" relative to today. Past years are fully
 * elapsed (13), future years haven't started (1). Transfer calculations use this
 * instead of the calendar month so a non-current ACTIVE year is handled sanely.
 */
export function effectiveCurrentMonth(budgetYear: number, now: Date = new Date()): number {
  const year = now.getFullYear()
  if (budgetYear < year) return 13
  if (budgetYear > year) return 1
  return now.getMonth() + 1
}

export async function recalculateTransfer(budgetYearId: string): Promise<void> {
  const budgetYear = await prisma.budgetYear.findUnique({
    where: { id: budgetYearId },
    include: { household: { select: { budgetModel: true } } },
  })
  if (!budgetYear || budgetYear.status !== 'ACTIVE') return

  const { budgetModel } = budgetYear.household
  const year = budgetYear.year
  const currentMonth = effectiveCurrentMonth(year)

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

  const perMonth = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString())),
    new Decimal(0),
  )

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
  expenses: ScheduleSource[],
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

// ── PAY_NO_PAY occurrences ───────────────────────────────────────────────────

type ExistingOccurrence = { id: string; entryId: string; month: number; status: string; scheduledAmount: Decimal }

export type OccurrenceSyncPlan = {
  create: { entryId: string; month: number; scheduledAmount: Decimal }[]
  update: { id: string; scheduledAmount: Decimal }[]
}

/**
 * Plans how occurrence rows for the given months must change so PENDING rows match
 * each entry's current schedule. PAID and SKIPPED rows are history and never touched.
 * `scheduleFor` returns the amount due for an entry in a month, or null when inactive.
 */
export function planOccurrenceSync(
  entryIds: string[],
  months: number[],
  existing: ExistingOccurrence[],
  scheduleFor: (entryId: string, month: number) => Decimal | null,
): OccurrenceSyncPlan {
  const byKey = new Map(existing.map((o) => [`${o.entryId}:${o.month}`, o]))
  const plan: OccurrenceSyncPlan = { create: [], update: [] }
  for (const entryId of entryIds) {
    for (const month of months) {
      const scheduled = scheduleFor(entryId, month)
      const occ = byKey.get(`${entryId}:${month}`)
      if (!occ) {
        if (scheduled !== null) plan.create.push({ entryId, month, scheduledAmount: scheduled })
        continue
      }
      if (occ.status !== 'PENDING') continue
      const target = scheduled ?? new Decimal(0)
      if (!new Decimal(occ.scheduledAmount.toString()).eq(target)) plan.update.push({ id: occ.id, scheduledAmount: target })
    }
  }
  return plan
}

/** Amount still owed on an occurrence: scheduled + carried − paid so far. */
export function unpaidAmount(occ: { scheduledAmount: Decimal; carriedAmount: Decimal; actualAmount: Decimal | null }): Decimal {
  return new Decimal(occ.scheduledAmount.toString())
    .add(new Decimal(occ.carriedAmount.toString()))
    .sub(occ.actualAmount ? new Decimal(occ.actualAmount.toString()) : new Decimal(0))
}

/**
 * Month total for the transfer: everything due that month (scheduled + carried),
 * whether already paid or not. SKIPPED rows were closed and carried to a later
 * month, so they're excluded to avoid counting the same money twice.
 */
export function sumMonthObligations(
  occurrences: { month: number; status: string; scheduledAmount: Decimal; carriedAmount: Decimal }[],
): Map<number, Decimal> {
  const totals = new Map<number, Decimal>()
  for (const occ of occurrences) {
    if (occ.status === 'SKIPPED') continue
    const prev = totals.get(occ.month) ?? new Decimal(0)
    totals.set(occ.month, prev.add(new Decimal(occ.scheduledAmount.toString())).add(new Decimal(occ.carriedAmount.toString())))
  }
  return totals
}

async function recalculatePayNoPay(
  budgetYearId: string,
  year: number,
  currentMonth: number,
  expenses: ScheduleSource[],
  byMonth: Map<number, { status: string }>,
): Promise<void> {
  await syncPayNoPayOccurrences(budgetYearId, year, currentMonth, expenses)

  const [expOccs, savOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId }, year },
      select: { month: true, status: true, scheduledAmount: true, carriedAmount: true },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId }, year },
      select: { month: true, status: true, scheduledAmount: true, carriedAmount: true },
    }),
  ])
  const occByMonth = sumMonthObligations([...expOccs, ...savOccs])

  for (let m = 1; m <= 12; m++) {
    const existing = byMonth.get(m)
    if (existing && (existing.status === 'PAID' || existing.status === 'ADJUSTED')) continue
    // Closed months are history: keep an existing transfer as recorded
    if (existing && m < currentMonth) continue

    const calculatedAmount = occByMonth.get(m) ?? new Decimal(0)

    await prisma.budgetTransfer.upsert({
      where: { budgetYearId_month_year: { budgetYearId, month: m, year } },
      create: { budgetYearId, year, month: m, calculatedAmount, calculatedAt: new Date() },
      update: { calculatedAmount, calculatedAt: new Date() },
    })
  }
}

/**
 * Creates missing occurrence rows from the current month through December and
 * updates PENDING rows whose schedule changed (e.g. after an expense edit), so
 * every remaining month reflects the current expenses and savings.
 */
async function syncPayNoPayOccurrences(
  budgetYearId: string,
  year: number,
  currentMonth: number,
  expenses: ScheduleSource[],
): Promise<void> {
  const months = Array.from({ length: Math.max(0, 13 - currentMonth) }, (_, i) => currentMonth + i)
  if (months.length === 0) return

  const [existingExpOccs, savingsEntries, existingSavOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId }, year, month: { in: months } },
      select: { id: true, expenseId: true, month: true, status: true, scheduledAmount: true },
    }),
    prisma.savingsEntry.findMany({ where: { budgetYearId }, select: { id: true, monthlyEquivalent: true } }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId }, year, month: { in: months } },
      select: { id: true, savingsEntryId: true, month: true, status: true, scheduledAmount: true },
    }),
  ])

  const expenseById = new Map(expenses.map((e) => [e.id, e]))
  const expPlan = planOccurrenceSync(
    expenses.map((e) => e.id),
    months,
    existingExpOccs.map((o) => ({ ...o, entryId: o.expenseId })),
    (id, month) => calcOccurrenceScheduledAmount(expenseById.get(id)!, month),
  )
  const savingsById = new Map(savingsEntries.map((s) => [s.id, s]))
  const savPlan = planOccurrenceSync(
    savingsEntries.map((s) => s.id),
    months,
    existingSavOccs.map((o) => ({ ...o, entryId: o.savingsEntryId })),
    (id) => new Decimal(savingsById.get(id)!.monthlyEquivalent.toString()),
  )

  // skipDuplicates: concurrent recalculations may race to create the same rows
  await Promise.all([
    expPlan.create.length > 0
      ? prisma.expenseOccurrence.createMany({
          data: expPlan.create.map((c) => ({ expenseId: c.entryId, year, month: c.month, scheduledAmount: c.scheduledAmount })),
          skipDuplicates: true,
        })
      : Promise.resolve(),
    savPlan.create.length > 0
      ? prisma.savingsOccurrence.createMany({
          data: savPlan.create.map((c) => ({ savingsEntryId: c.entryId, year, month: c.month, scheduledAmount: c.scheduledAmount })),
          skipDuplicates: true,
        })
      : Promise.resolve(),
    ...expPlan.update.map((u) => prisma.expenseOccurrence.update({ where: { id: u.id }, data: { scheduledAmount: u.scheduledAmount } })),
    ...savPlan.update.map((u) => prisma.savingsOccurrence.update({ where: { id: u.id }, data: { scheduledAmount: u.scheduledAmount } })),
  ])
}

/** Marks every PENDING occurrence of a month SKIPPED (closed). Safe to run repeatedly. */
export async function closePayNoPayMonth(budgetYearId: string, year: number, month: number): Promise<void> {
  await Promise.all([
    prisma.expenseOccurrence.updateMany({
      where: { expense: { budgetYearId }, year, month, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    }),
    prisma.savingsOccurrence.updateMany({
      where: { savingsEntry: { budgetYearId }, year, month, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    }),
  ])
}

/** Unpaid balance per entry from a closed month's SKIPPED occurrences. */
export function carryFromClosedMonth(
  occurrences: { entryId: string; status: string; scheduledAmount: Decimal; carriedAmount: Decimal; actualAmount: Decimal | null }[],
): Map<string, Decimal> {
  const carry = new Map<string, Decimal>()
  for (const occ of occurrences) {
    if (occ.status !== 'SKIPPED') continue
    const unpaid = unpaidAmount(occ)
    if (unpaid.gt(0)) carry.set(occ.entryId, unpaid)
  }
  return carry
}

/**
 * Called at month rollover (within one budget year) for PAY_NO_PAY households.
 * Closes the month (PENDING → SKIPPED) and carries each closed item's unpaid balance
 * into the opening month. Carry is derived from all SKIPPED rows of the closing
 * month, so re-running (manual trigger, second replica) produces the same result
 * instead of wiping the carry.
 */
export async function rolloverPayNoPayOccurrences(
  budgetYearId: string,
  year: number,
  closingMonth: number,
  openingMonth: number,
): Promise<void> {
  await closePayNoPayMonth(budgetYearId, year, closingMonth)

  const [closedExpOccs, closedSavOccs, expenses, savingsEntries] = await Promise.all([
    prisma.expenseOccurrence.findMany({ where: { expense: { budgetYearId }, year, month: closingMonth, status: 'SKIPPED' } }),
    prisma.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId }, year, month: closingMonth, status: 'SKIPPED' } }),
    prisma.expense.findMany({
      where: { budgetYearId },
      select: { id: true, monthlyEquivalent: true, startMonth: true, endMonth: true },
    }),
    prisma.savingsEntry.findMany({ where: { budgetYearId }, select: { id: true, monthlyEquivalent: true } }),
  ])

  const expenseCarry = carryFromClosedMonth(closedExpOccs.map((o) => ({ ...o, entryId: o.expenseId })))
  const savingsCarry = carryFromClosedMonth(closedSavOccs.map((o) => ({ ...o, entryId: o.savingsEntryId })))

  await Promise.all([
    ...expenses.map(async (expense) => {
      const scheduledAmount = calcOccurrenceScheduledAmount(expense, openingMonth)
      const carriedAmount = expenseCarry.get(expense.id) ?? new Decimal(0)
      if (scheduledAmount === null && carriedAmount.eq(0)) return
      await upsertOpeningOccurrence('expense', expense.id, year, openingMonth, scheduledAmount ?? new Decimal(0), carriedAmount)
    }),
    ...savingsEntries.map(async (entry) => {
      const carriedAmount = savingsCarry.get(entry.id) ?? new Decimal(0)
      await upsertOpeningOccurrence('savings', entry.id, year, openingMonth, new Decimal(entry.monthlyEquivalent.toString()), carriedAmount)
    }),
  ])
}

async function upsertOpeningOccurrence(
  kind: 'expense' | 'savings',
  entryId: string,
  year: number,
  month: number,
  scheduledAmount: Decimal,
  carriedAmount: Decimal,
): Promise<void> {
  // A row the user already marked PAID gets new carry → it owes money again, so reopen it
  const reopen = carriedAmount.gt(0) ? { status: 'PENDING' as const } : {}
  if (kind === 'expense') {
    await prisma.expenseOccurrence.upsert({
      where: { expenseId_year_month: { expenseId: entryId, year, month } },
      create: { expenseId: entryId, year, month, scheduledAmount, carriedAmount },
      update: { carriedAmount, ...reopen },
    })
  } else {
    await prisma.savingsOccurrence.upsert({
      where: { savingsEntryId_year_month: { savingsEntryId: entryId, year, month } },
      create: { savingsEntryId: entryId, year, month, scheduledAmount, carriedAmount },
      update: { carriedAmount, ...reopen },
    })
  }
}
