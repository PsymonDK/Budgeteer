import { describe, expect, it } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { buildMonthPayments, daysInMonth, occurrenceKey, type TrackedOccurrence } from './payments'

const d = (v: string) => new Decimal(v)

type ExpenseRow = Parameters<typeof buildMonthPayments>[0]['expenses'][number]
type SavingsRow = Parameters<typeof buildMonthPayments>[0]['savings'][number]

const expense = (over: Partial<ExpenseRow> & { id: string }): ExpenseRow => ({
  label: over.id, category: { name: 'Housing' }, dueDay: null, frequency: 'MONTHLY',
  startMonth: null, endMonth: null, monthlyEquivalent: d('1000'), amount: d('1000'), rateUsed: null,
  ...over,
})
const saving = (over: Partial<SavingsRow> & { id: string }): SavingsRow => ({
  label: over.id, category: null, dueDay: null, frequency: 'MONTHLY', monthlyEquivalent: d('500'), ...over,
})

describe('daysInMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })
})

describe('buildMonthPayments (untracked household)', () => {
  const run = (month: number, expenses: ExpenseRow[], savings: SavingsRow[] = []) =>
    buildMonthPayments({ year: 2026, month, expenses, savings, occurrences: null })

  it('lists monthly expenses and savings with their day, sorted by day', () => {
    const { items } = run(10, [expense({ id: 'rent', dueDay: 1 }), expense({ id: 'power', dueDay: 15 })], [saving({ id: 'buffer', dueDay: 5 })])
    expect(items.map((i) => [i.entryId, i.day])).toEqual([['rent', 1], ['buffer', 5], ['power', 15]])
    expect(items.every((i) => i.status === null)).toBe(true)
  })

  it('only includes quarterly and annual expenses in the months they fall in', () => {
    const quarterly = expense({ id: 'water', frequency: 'QUARTERLY', amount: d('900'), monthlyEquivalent: d('300') })
    expect(run(10, [quarterly]).items).toHaveLength(0)
    const december = run(12, [quarterly]).items
    expect(december).toHaveLength(1)
    expect(december[0].amount).toBe('900.00')
  })

  it('skips expenses outside their active months', () => {
    expect(run(2, [expense({ id: 'summer', startMonth: 6, endMonth: 8 })]).items).toHaveLength(0)
  })

  it('clamps day 31 to the month length', () => {
    expect(run(4, [expense({ id: 'rent', dueDay: 31 })]).items[0].day).toBe(30)
  })

  it('gives weekly and fortnightly items no single day', () => {
    const [item] = run(10, [expense({ id: 'groceries', frequency: 'WEEKLY', dueDay: 3 })]).items
    expect(item.day).toBeNull()
    expect(item.recurrence).toBe('WEEKLY')
  })

  it('puts items without a day last', () => {
    const { items } = run(10, [expense({ id: 'netflix' }), expense({ id: 'rent', dueDay: 28 })])
    expect(items.map((i) => i.entryId)).toEqual(['rent', 'netflix'])
  })

  it('totals what is due, without paid figures', () => {
    const { totals } = run(10, [expense({ id: 'rent', amount: d('1200'), monthlyEquivalent: d('1200') })], [saving({ id: 'buffer' })])
    expect(totals).toEqual({ count: 2, due: '1700.00', paidCount: null, unpaid: null })
  })
})

describe('buildMonthPayments (Pay/No-pay household)', () => {
  const occ = (status: TrackedOccurrence['status'], due: string): TrackedOccurrence => ({ status, dueAmount: d(due) })

  it('uses the occurrence amount and status, and counts paid items', () => {
    const occurrences = new Map([
      [occurrenceKey('expense', 'rent'), occ('PAID', '1000')],
      [occurrenceKey('expense', 'power'), occ('PENDING', '450')], // includes a carried amount
      [occurrenceKey('savings', 'buffer'), occ('SKIPPED', '500')],
    ])
    const { items, totals } = buildMonthPayments({
      year: 2026, month: 10, occurrences,
      expenses: [expense({ id: 'rent', dueDay: 1 }), expense({ id: 'power', dueDay: 20, monthlyEquivalent: d('300'), amount: d('300') })],
      savings: [saving({ id: 'buffer', dueDay: 2 })],
    })
    expect(items.find((i) => i.entryId === 'power')).toMatchObject({ amount: '450.00', status: 'PENDING' })
    expect(totals).toEqual({ count: 2, due: '1450.00', paidCount: 1, unpaid: '450.00' })
  })

  it('shows scheduled items without an occurrence as untracked (status null)', () => {
    const { items } = buildMonthPayments({
      year: 2026, month: 10, occurrences: new Map(), expenses: [expense({ id: 'rent' })], savings: [],
    })
    expect(items[0].status).toBeNull()
  })
})
