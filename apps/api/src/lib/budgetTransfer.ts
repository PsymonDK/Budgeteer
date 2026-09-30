import { Decimal } from '@prisma/client/runtime/client'
import { prisma, notDeleted } from './prisma'
import { Frequency } from '@prisma/client'
import { calcForwardMonthlyNeed, calcOccurrenceScheduledAmount, activeMonthCount, expenseMonthSchedule } from './calculations'
import { dueAmount } from './occurrences'

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
    await recalculatePayNoPay(budgetYearId, year, currentMonth, byMonth)
    return
  }

  const perMonth = expenses.reduce(
    (sum, e) => sum.add(new Decimal(e.monthlyEquivalent.toString())),
    new Decimal(0),
  )

  if (budgetModel === 'FORWARD_LOOKING') {
    await recalculateForwardLooking(budgetYearId, year, currentMonth, expenses, byMonth, perMonth)
    await syncOccurrences(budgetYearId, year, currentMonth, 'MANUAL_ONLY')
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

  await syncOccurrences(budgetYearId, year, currentMonth, 'MANUAL_ONLY')
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

// ── Occurrences ──────────────────────────────────────────────────────────────
// PAY_NO_PAY households have a row per entry per month; it drives the transfer and
// carries unpaid balances. AVERAGE and FORWARD_LOOKING households have rows only for
// manually paid entries: tracking for the to-pay list, never read by their transfer.

type ExistingOccurrence = { id: string; entryId: string; month: number; status: string; scheduledAmount: Decimal }

export type OccurrenceSyncPlan = {
  create: { entryId: string; month: number; scheduledAmount: Decimal }[]
  update: { id: string; scheduledAmount: Decimal }[]
}

/**
 * Plans how occurrence rows for the given months must change so PENDING rows match
 * each entry's current schedule. PAID, SKIPPED and DISMISSED rows are history and never touched.
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
  byMonth: Map<number, { status: string }>,
): Promise<void> {
  await syncOccurrences(budgetYearId, year, currentMonth, 'ALL')

  const [expOccs, savOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId, ...notDeleted }, year },
      select: { month: true, status: true, scheduledAmount: true, carriedAmount: true },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId, ...notDeleted }, year },
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
 * Amount a tracked (Average / Forward-looking) manual expense is due in a month: the bill
 * as charged that month, so a quarterly bill is due in full in its months and not at all
 * in between. Null when nothing is due.
 */
export function trackingScheduledAmount(
  expense: { frequency: Frequency; startMonth: number | null; endMonth: number | null; monthlyEquivalent: Decimal; amount: Decimal; rateUsed: Decimal | null },
  month: number,
): Decimal | null {
  const due = expenseMonthSchedule(expense)[month - 1]
  return due == null ? null : new Decimal(due)
}

/**
 * Creates missing occurrence rows from the current month through December and
 * updates PENDING rows whose schedule changed (e.g. after an expense edit), so
 * every remaining month reflects the current expenses and savings.
 * - `ALL` (Pay/No-pay): every entry, each month's share of it.
 * - `MANUAL_ONLY` (Average / Forward-looking): manually paid entries only, the bill as charged.
 */
async function syncOccurrences(
  budgetYearId: string,
  year: number,
  currentMonth: number,
  mode: 'ALL' | 'MANUAL_ONLY',
): Promise<void> {
  const months = Array.from({ length: Math.max(0, 13 - currentMonth) }, (_, i) => currentMonth + i)
  if (months.length === 0) return

  const entryFilter = mode === 'MANUAL_ONLY' ? { paymentMethod: 'MANUAL' as const } : {}
  const [expenses, existingExpOccs, savingsEntries, existingSavOccs] = await Promise.all([
    prisma.expense.findMany({
      where: { budgetYearId, ...entryFilter },
      select: { id: true, frequency: true, amount: true, rateUsed: true, monthlyEquivalent: true, startMonth: true, endMonth: true },
    }),
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId, ...notDeleted }, year, month: { in: months } },
      select: { id: true, expenseId: true, month: true, status: true, scheduledAmount: true },
    }),
    prisma.savingsEntry.findMany({ where: { budgetYearId, ...entryFilter }, select: { id: true, monthlyEquivalent: true } }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId, ...notDeleted }, year, month: { in: months } },
      select: { id: true, savingsEntryId: true, month: true, status: true, scheduledAmount: true },
    }),
  ])

  const expenseById = new Map(expenses.map((e) => [e.id, e]))
  const expenseSchedule = mode === 'ALL' ? calcOccurrenceScheduledAmount : trackingScheduledAmount
  const expPlan = planOccurrenceSync(
    expenses.map((e) => e.id),
    months,
    existingExpOccs.map((o) => ({ ...o, entryId: o.expenseId })),
    (id, month) => expenseSchedule(expenseById.get(id)!, month),
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

/**
 * How a month's still-PENDING occurrences close: items paid automatically (direct debit,
 * standing order) count as paid in full, so they never carry over; manual items close
 * as SKIPPED and their unpaid balance carries into the next month.
 */
export function planMonthClose(
  pending: { id: string; paymentMethod: 'AUTOMATIC' | 'MANUAL'; scheduledAmount: Decimal; carriedAmount: Decimal }[],
): { skip: string[]; autoPay: { id: string; actualAmount: Decimal }[] } {
  const plan: { skip: string[]; autoPay: { id: string; actualAmount: Decimal }[] } = { skip: [], autoPay: [] }
  for (const occ of pending) {
    if (occ.paymentMethod === 'AUTOMATIC') plan.autoPay.push({ id: occ.id, actualAmount: dueAmount(occ) })
    else plan.skip.push(occ.id)
  }
  return plan
}

/**
 * Closes a month: PENDING manual occurrences become SKIPPED, PENDING automatic ones PAID
 * (see planMonthClose). Only PENDING rows are touched, so it's safe to run repeatedly.
 */
export async function closePayNoPayMonth(budgetYearId: string, year: number, month: number): Promise<void> {
  const [expenseOccs, savingsOccs] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where: { expense: { budgetYearId, ...notDeleted }, year, month, status: 'PENDING' },
      select: { id: true, scheduledAmount: true, carriedAmount: true, expense: { select: { paymentMethod: true } } },
    }),
    prisma.savingsOccurrence.findMany({
      where: { savingsEntry: { budgetYearId, ...notDeleted }, year, month, status: 'PENDING' },
      select: { id: true, scheduledAmount: true, carriedAmount: true, savingsEntry: { select: { paymentMethod: true } } },
    }),
  ])
  const expPlan = planMonthClose(expenseOccs.map((o) => ({ ...o, paymentMethod: o.expense.paymentMethod })))
  const savPlan = planMonthClose(savingsOccs.map((o) => ({ ...o, paymentMethod: o.savingsEntry.paymentMethod })))
  const paidAt = new Date()

  await prisma.$transaction([
    prisma.expenseOccurrence.updateMany({ where: { id: { in: expPlan.skip }, status: 'PENDING' }, data: { status: 'SKIPPED' } }),
    prisma.savingsOccurrence.updateMany({ where: { id: { in: savPlan.skip }, status: 'PENDING' }, data: { status: 'SKIPPED' } }),
    ...expPlan.autoPay.map((p) =>
      prisma.expenseOccurrence.update({ where: { id: p.id }, data: { status: 'PAID', paidAt, actualAmount: p.actualAmount } })),
    ...savPlan.autoPay.map((p) =>
      prisma.savingsOccurrence.update({ where: { id: p.id }, data: { status: 'PAID', paidAt, actualAmount: p.actualAmount } })),
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
    prisma.expenseOccurrence.findMany({ where: { expense: { budgetYearId, ...notDeleted }, year, month: closingMonth, status: 'SKIPPED' } }),
    prisma.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId, ...notDeleted }, year, month: closingMonth, status: 'SKIPPED' } }),
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
