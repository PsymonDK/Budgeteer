import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { isListable, occurrenceTotals, toOccurrenceItem, toTransferItem, type OccurrenceStatus } from './occurrences'

const entry = { id: 'e1', label: 'Rent', categoryName: 'Housing' }
const row = (status: OccurrenceStatus, scheduled: number, carried = 0, actual: number | null = null) => ({
  id: `o-${status}-${scheduled}`,
  month: 10,
  status,
  dismissReason: status === 'DISMISSED' ? ('PAID_ELSEWHERE' as const) : null,
  scheduledAmount: new Decimal(scheduled),
  carriedAmount: new Decimal(carried),
  actualAmount: actual === null ? null : new Decimal(actual),
  paidAt: null,
})

describe('toOccurrenceItem', () => {
  it('reports the due amount as schedule plus carry-over', () => {
    const item = toOccurrenceItem(row('PENDING', 1000, 250), 'expense', entry)
    expect(item).toMatchObject({ kind: 'expense', entryId: 'e1', label: 'Rent', scheduledAmount: '1000.00', carriedAmount: '250.00', dueAmount: '1250.00', actualAmount: null })
  })
})

describe('occurrenceTotals', () => {
  it('sums due, paid and what would carry over', () => {
    const items = [
      toOccurrenceItem(row('PAID', 1000, 0, 1000), 'expense', entry),
      toOccurrenceItem(row('PENDING', 500, 100), 'expense', entry),
      toOccurrenceItem(row('SKIPPED', 999), 'savings', entry),
    ]
    expect(occurrenceTotals(items)).toEqual({ due: '1600.00', paid: '1000.00', unpaid: '600.00' })
  })
})

describe('dismissed and placeholder rows', () => {
  it('leaves dismissed items out of the totals', () => {
    const items = [
      toOccurrenceItem(row('PENDING', 500), 'expense', entry),
      toOccurrenceItem(row('DISMISSED', 300), 'expense', entry),
    ]
    expect(occurrenceTotals(items)).toEqual({ due: '500.00', paid: '0.00', unpaid: '500.00' })
  })

  it('reports the month and why an item was dismissed', () => {
    expect(toOccurrenceItem(row('DISMISSED', 300), 'savings', entry)).toMatchObject({ month: 10, status: 'DISMISSED', dismissReason: 'PAID_ELSEWHERE' })
  })

  it('lists rows with something due, and settled rows whatever their amount', () => {
    expect(isListable(row('PENDING', 100))).toBe(true)
    expect(isListable(row('PENDING', 0, 50))).toBe(true) // only a carried balance
    expect(isListable(row('PENDING', 0))).toBe(false) // placeholder: inactive month
    expect(isListable(row('PAID', 0))).toBe(true)
  })
})

describe('toTransferItem', () => {
  const transfer = (month: number) => ({ id: 't1', year: 2026, month, calculatedAmount: new Decimal(3356.67), status: 'PENDING' as const, actualAmount: null })

  it('reports the planned amount and the due day', () => {
    expect(toTransferItem(transfer(9), 25)).toEqual({ id: 't1', month: 9, amount: '3356.67', status: 'PENDING', actualAmount: null, dueDay: 25 })
  })

  it('clamps the due day to the month length', () => {
    expect(toTransferItem(transfer(9), 31).dueDay).toBe(30)
    expect(toTransferItem(transfer(2), 30).dueDay).toBe(28)
  })
})
