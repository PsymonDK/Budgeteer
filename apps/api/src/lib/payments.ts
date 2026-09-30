import { Frequency, PaymentMethod } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { expenseMonthSchedule } from './calculations'

export type PaymentKind = 'expense' | 'savings'
export type PaymentStatus = 'PENDING' | 'PAID' | 'SKIPPED' | 'DISMISSED'
export type DismissReason = 'PAID_ELSEWHERE' | 'SKIPPED'

/** One expense or savings payment in a month, for the dashboard's payments timeline. */
export interface MonthPayment {
  kind: PaymentKind
  entryId: string
  label: string
  categoryName: string | null
  /** The entry's day of the month, clamped to the month's length (31 → 30 in April); null = no set day */
  day: number | null
  /** Set for entries paid several times a month; they have no single day */
  recurrence: 'WEEKLY' | 'FORTNIGHTLY' | null
  /** AUTOMATIC items go out on their own; MANUAL ones the household pays itself */
  paymentMethod: PaymentMethod
  /** Amount due this month in base currency */
  amount: string
  /**
   * Paid status from the month's occurrence: manual items in every budget model, automatic
   * ones too in Pay/No-pay. Null when the item has no occurrence (automatic items in the
   * other models, or a month before tracking started).
   */
  status: PaymentStatus | null
  /** Why it was taken off the to-pay list, when DISMISSED */
  dismissReason: DismissReason | null
}

export interface MonthPaymentsTotals {
  count: number
  /** Sum of all amounts due this month */
  due: string
  /** Items paid by hand */
  manualCount: number
  /** Manual items that are done: marked paid, or dismissed */
  doneCount: number
  /** Amount still to pay on manual items that aren't done */
  unpaid: string
}

interface ExpenseInput {
  id: string
  label: string
  category: { name: string } | null
  dueDay: number | null
  paymentMethod: PaymentMethod
  frequency: Frequency
  startMonth: number | null
  endMonth: number | null
  monthlyEquivalent: Decimal
  amount: Decimal
  rateUsed: Decimal | null
}

interface SavingsInput {
  id: string
  label: string
  category: { name: string } | null
  dueDay: number | null
  paymentMethod: PaymentMethod
  frequency: Frequency
  monthlyEquivalent: Decimal
}

/** The month's occurrence for an entry, keyed by `${kind}:${entryId}`. */
export interface TrackedOccurrence {
  status: PaymentStatus
  dismissReason: DismissReason | null
  dueAmount: Decimal
}

export const occurrenceKey = (kind: PaymentKind, entryId: string) => `${kind}:${entryId}`

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const SEVERAL_A_MONTH = new Set<Frequency>(['WEEKLY', 'FORTNIGHTLY'])

/**
 * The month's payments: expenses due in `month` (from their month schedule, so quarterly and
 * annual items only appear in the months they fall in) and savings contributions, each with
 * its due day. Where an entry has an occurrence, its due amount and status are used.
 * Sorted by day (no set day last), then kind and label.
 */
export function buildMonthPayments(input: {
  year: number
  month: number
  expenses: ExpenseInput[]
  savings: SavingsInput[]
  /** The month's occurrences; entries without one have no status */
  occurrences: Map<string, TrackedOccurrence>
}): { items: MonthPayment[]; totals: MonthPaymentsTotals } {
  const { year, month, occurrences } = input
  const lastDay = daysInMonth(year, month)
  const dayOf = (dueDay: number | null, frequency: Frequency) =>
    dueDay == null || SEVERAL_A_MONTH.has(frequency) ? null : Math.min(dueDay, lastDay)
  const recurrenceOf = (frequency: Frequency) => (SEVERAL_A_MONTH.has(frequency) ? (frequency as 'WEEKLY' | 'FORTNIGHTLY') : null)

  const items: (MonthPayment & { amountDec: Decimal })[] = []

  for (const e of input.expenses) {
    const tracked = occurrences.get(occurrenceKey('expense', e.id))
    const scheduled = expenseMonthSchedule(e)[month - 1]
    const amount = tracked ? tracked.dueAmount : scheduled != null ? new Decimal(scheduled) : null
    if (amount == null) continue // not due this month
    items.push({
      kind: 'expense', entryId: e.id, label: e.label, categoryName: e.category?.name ?? null,
      day: dayOf(e.dueDay, e.frequency), recurrence: recurrenceOf(e.frequency), paymentMethod: e.paymentMethod,
      amount: amount.toFixed(2), amountDec: amount,
      status: tracked?.status ?? null, dismissReason: tracked?.dismissReason ?? null,
    })
  }

  for (const s of input.savings) {
    const tracked = occurrences.get(occurrenceKey('savings', s.id))
    const amount = tracked ? tracked.dueAmount : new Decimal(s.monthlyEquivalent.toString())
    items.push({
      kind: 'savings', entryId: s.id, label: s.label, categoryName: s.category?.name ?? null,
      day: dayOf(s.dueDay, s.frequency), recurrence: recurrenceOf(s.frequency), paymentMethod: s.paymentMethod,
      amount: amount.toFixed(2), amountDec: amount,
      status: tracked?.status ?? null, dismissReason: tracked?.dismissReason ?? null,
    })
  }

  items.sort((a, b) =>
    (a.day ?? 99) - (b.day ?? 99) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))

  const counted = items.filter((i) => i.status !== 'SKIPPED')
  const manual = counted.filter((i) => i.paymentMethod === 'MANUAL')
  const isDone = (i: MonthPayment) => i.status === 'PAID' || i.status === 'DISMISSED'
  const due = counted.reduce((sum, i) => sum.add(i.amountDec), new Decimal(0))
  const totals: MonthPaymentsTotals = {
    count: counted.length,
    due: due.toFixed(2),
    manualCount: manual.length,
    doneCount: manual.filter(isDone).length,
    unpaid: manual.filter((i) => !isDone(i)).reduce((sum, i) => sum.add(i.amountDec), new Decimal(0)).toFixed(2),
  }

  return { items: items.map(({ amountDec: _amountDec, ...item }) => item), totals }
}
