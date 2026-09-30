import { describe, expect, it } from 'vitest'
import {
  currentStage, daysBetween, deliveryKey, digestStage, digestTimeReached, dueDateFor, planDigest, recipientsFor, remindersFor,
  toISODate, type ReminderItem,
} from './reminders'

const item = (over: Partial<ReminderItem> & { key: string; dueDate: string }): ReminderItem => ({
  kind: 'expense', label: over.key, amount: '100.00', householdId: 'h1', householdName: 'Home', budgetYearId: 'by1',
  recipientIds: ['anna', 'mads'], ...over,
})

describe('dates', () => {
  it('uses the due day, clamped to the month, and the 1st when there is none', () => {
    expect(dueDateFor(2026, 9, 25)).toBe('2026-09-25')
    expect(dueDateFor(2026, 9, 31)).toBe('2026-09-30')
    expect(dueDateFor(2026, 2, 30)).toBe('2026-02-28')
    expect(dueDateFor(2026, 10, null)).toBe('2026-10-01')
  })

  it('counts whole days across month ends', () => {
    expect(daysBetween('2026-09-29', '2026-10-01')).toBe(2)
    expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3)
    expect(toISODate(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05')
  })
})

describe('reminder stages', () => {
  it('is due soon within the lead time, due today on the day', () => {
    expect(currentStage('2026-10-01', '2026-09-28', 2)).toBeNull()
    expect(currentStage('2026-10-01', '2026-09-29', 2)).toBe('DUE_SOON')
    expect(currentStage('2026-10-01', '2026-10-01', 2)).toBe('DUE_TODAY')
  })

  it('shows anything past due as overdue in the app', () => {
    expect(currentStage('2026-10-01', '2026-10-02', 2)).toBe('OVERDUE')
  })

  it('sends the overdue reminder only once it is 3 days late', () => {
    expect(digestStage('2026-10-01', '2026-10-02', 2)).toBeNull()
    expect(digestStage('2026-10-01', '2026-10-03', 2)).toBeNull()
    expect(digestStage('2026-10-01', '2026-10-04', 2)).toBe('OVERDUE')
    expect(digestStage('2026-10-01', '2026-09-29', 2)).toBe('DUE_SOON')
  })

  it('knows when the digest time has come', () => {
    expect(digestTimeReached(new Date(2026, 8, 30, 7, 59), '08:00')).toBe(false)
    expect(digestTimeReached(new Date(2026, 8, 30, 8, 0), '08:00')).toBe(true)
  })
})

describe('recipientsFor', () => {
  const members = ['anna', 'mads']
  const splits = (pcts: Record<string, number>) => Object.entries(pcts).map(([userId, pct]) => ({ userId, pct }))

  it('reminds the owner of an individual item', () => {
    expect(recipientsFor({ ownership: 'INDIVIDUAL', ownedByUserId: 'mads', customSplits: [] }, members)).toEqual(['mads'])
  })

  it('reminds everyone about a shared item, or an individual one whose owner left', () => {
    expect(recipientsFor({ ownership: 'SHARED', ownedByUserId: null, customSplits: [] }, members)).toEqual(members)
    expect(recipientsFor({ ownership: 'INDIVIDUAL', ownedByUserId: 'gone', customSplits: [] }, members)).toEqual(members)
  })

  it('reminds members with a share of a custom split', () => {
    expect(recipientsFor({ ownership: 'CUSTOM', ownedByUserId: null, customSplits: splits({ anna: 100, mads: 0 }) }, members)).toEqual(['anna'])
  })
})

describe('remindersFor', () => {
  const items = [
    item({ key: 'expense:rent', dueDate: '2026-10-01' }),
    item({ key: 'expense:gym', dueDate: '2026-09-20', recipientIds: ['mads'] }),
    item({ key: 'savings:holiday', dueDate: '2026-09-30' }),
    item({ key: 'expense:later', dueDate: '2026-10-15' }),
  ]

  it('lists a member’s items with a stage, overdue first then by date', () => {
    const r = remindersFor('mads', items, '2026-09-30', 2, 'current')
    expect(r.map((x) => [x.item.key, x.stage])).toEqual([
      ['expense:gym', 'OVERDUE'], ['savings:holiday', 'DUE_TODAY'], ['expense:rent', 'DUE_SOON'],
    ])
  })

  it('leaves out items the member isn’t reminded about', () => {
    expect(remindersFor('anna', items, '2026-09-30', 2, 'current').map((x) => x.item.key)).not.toContain('expense:gym')
  })
})

describe('planDigest', () => {
  const items = [item({ key: 'expense:rent', dueDate: '2026-10-01' }), item({ key: 'expense:power', dueDate: '2026-10-01' })]

  it('puts two items due the same day in one digest', () => {
    const digest = planDigest(remindersFor('anna', items, '2026-09-29', 2, 'digest'), new Set())
    expect(digest.map((r) => r.item.key)).toEqual(['expense:power', 'expense:rent'])
  })

  it('sends nothing new on a second run once the first was logged', () => {
    const first = planDigest(remindersFor('anna', items, '2026-09-29', 2, 'digest'), new Set())
    const logged = new Set(first.map(deliveryKey))
    expect(planDigest(remindersFor('anna', items, '2026-09-29', 2, 'digest'), logged)).toEqual([])
  })

  it('sends the next stage of an item that was already reminded about', () => {
    const logged = new Set(['DUE_SOON:expense:rent', 'DUE_SOON:expense:power'])
    const dueDay = planDigest(remindersFor('anna', items, '2026-10-01', 2, 'digest'), logged)
    expect(dueDay.map((r) => deliveryKey(r))).toEqual(['DUE_TODAY:expense:power', 'DUE_TODAY:expense:rent'])
  })
})
