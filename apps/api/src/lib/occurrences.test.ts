import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { occurrenceTotals, toOccurrenceItem } from './occurrences'

const entry = { id: 'e1', label: 'Rent', categoryName: 'Housing' }
const row = (status: 'PENDING' | 'PAID' | 'SKIPPED', scheduled: number, carried = 0, actual: number | null = null) => ({
  id: `o-${status}-${scheduled}`,
  status,
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
