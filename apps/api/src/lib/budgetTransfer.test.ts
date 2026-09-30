import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  carryFromClosedMonth,
  effectiveCurrentMonth,
  planMonthClose,
  trackingScheduledAmount,
  planOccurrenceSync,
  sumMonthObligations,
  unpaidAmount,
} from './budgetTransfer'

const d = (v: number | string) => new Decimal(v)

describe('effectiveCurrentMonth', () => {
  const now = new Date(2026, 8, 28) // 28 Sep 2026
  it('uses the calendar month for the current year', () => {
    expect(effectiveCurrentMonth(2026, now)).toBe(9)
  })
  it('treats past years as fully elapsed and future years as not started', () => {
    expect(effectiveCurrentMonth(2025, now)).toBe(13)
    expect(effectiveCurrentMonth(2027, now)).toBe(1)
  })
})

describe('planOccurrenceSync', () => {
  const schedule = (amounts: Record<string, number | null>) => (id: string, month: number) => {
    const v = amounts[`${id}:${month}`]
    return v === undefined || v === null ? null : d(v)
  }

  it('creates missing rows only for active months', () => {
    const plan = planOccurrenceSync(['a'], [9, 10], [], schedule({ 'a:9': 100, 'a:10': null }))
    expect(plan.create).toEqual([{ entryId: 'a', month: 9, scheduledAmount: d(100) }])
    expect(plan.update).toEqual([])
  })

  it('updates PENDING rows when the schedule changed (expense edited)', () => {
    const existing = [{ id: 'o1', entryId: 'a', month: 9, status: 'PENDING', scheduledAmount: d(1000) }]
    const plan = planOccurrenceSync(['a'], [9], existing, schedule({ 'a:9': 2000 }))
    expect(plan.update).toEqual([{ id: 'o1', scheduledAmount: d(2000) }])
  })

  it('zeroes a PENDING row whose month is no longer active', () => {
    const existing = [{ id: 'o1', entryId: 'a', month: 9, status: 'PENDING', scheduledAmount: d(500) }]
    const plan = planOccurrenceSync(['a'], [9], existing, schedule({}))
    expect(plan.update).toEqual([{ id: 'o1', scheduledAmount: d(0) }])
  })

  it('never touches PAID or SKIPPED rows, and skips unchanged ones', () => {
    const existing = [
      { id: 'p', entryId: 'a', month: 9, status: 'PAID', scheduledAmount: d(1000) },
      { id: 's', entryId: 'a', month: 10, status: 'SKIPPED', scheduledAmount: d(1000) },
      { id: 'u', entryId: 'a', month: 11, status: 'PENDING', scheduledAmount: d('1000.00') },
    ]
    const plan = planOccurrenceSync(['a'], [9, 10, 11], existing, schedule({ 'a:9': 2000, 'a:10': 2000, 'a:11': 1000 }))
    expect(plan).toEqual({ create: [], update: [] })
  })
})

describe('sumMonthObligations', () => {
  it('counts paid and pending items so paying does not shrink the transfer', () => {
    const totals = sumMonthObligations([
      { month: 9, status: 'PAID', scheduledAmount: d(1000), carriedAmount: d(0) },
      { month: 9, status: 'PENDING', scheduledAmount: d(500), carriedAmount: d(250) },
      { month: 10, status: 'PENDING', scheduledAmount: d(1000), carriedAmount: d(0) },
    ])
    expect(totals.get(9)?.toString()).toBe('1750')
    expect(totals.get(10)?.toString()).toBe('1000')
  })

  it('excludes SKIPPED items, whose balance moved to a later month', () => {
    const totals = sumMonthObligations([
      { month: 8, status: 'SKIPPED', scheduledAmount: d(1000), carriedAmount: d(0) },
      { month: 8, status: 'PAID', scheduledAmount: d(300), carriedAmount: d(0) },
    ])
    expect(totals.get(8)?.toString()).toBe('300')
  })
})

describe('carry-over', () => {
  it('unpaidAmount subtracts what was already paid', () => {
    expect(unpaidAmount({ scheduledAmount: d(1000), carriedAmount: d(200), actualAmount: d(700) }).toString()).toBe('500')
    expect(unpaidAmount({ scheduledAmount: d(1000), carriedAmount: d(0), actualAmount: null }).toString()).toBe('1000')
  })

  it('carries only closed (SKIPPED) items with a positive balance', () => {
    const carry = carryFromClosedMonth([
      { entryId: 'rent', status: 'SKIPPED', scheduledAmount: d(1000), carriedAmount: d(0), actualAmount: null },
      { entryId: 'gym', status: 'PAID', scheduledAmount: d(300), carriedAmount: d(0), actualAmount: d(300) },
      { entryId: 'tv', status: 'SKIPPED', scheduledAmount: d(100), carriedAmount: d(0), actualAmount: d(100) },
    ])
    expect([...carry.entries()].map(([k, v]) => [k, v.toString()])).toEqual([['rent', '1000']])
  })

  it('is idempotent: the same closed rows give the same carry on a re-run', () => {
    const closed = [{ entryId: 'rent', status: 'SKIPPED', scheduledAmount: d(1000), carriedAmount: d(1000), actualAmount: null }]
    expect(carryFromClosedMonth(closed).get('rent')?.toString()).toBe('2000')
    expect(carryFromClosedMonth(closed).get('rent')?.toString()).toBe('2000')
  })
})

describe('planMonthClose', () => {
  const pending = (id: string, paymentMethod: 'AUTOMATIC' | 'MANUAL', scheduled: number, carried = 0) =>
    ({ id, paymentMethod, scheduledAmount: d(scheduled), carriedAmount: d(carried) })

  it('pays automatic items in full and closes manual ones as skipped', () => {
    const plan = planMonthClose([pending('rent', 'AUTOMATIC', 1000), pending('gym', 'MANUAL', 300)])
    expect(plan.skip).toEqual(['gym'])
    expect(plan.autoPay.map((p) => [p.id, p.actualAmount.toString()])).toEqual([['rent', '1000']])
  })

  it('settles an automatic item\'s carried balance too, so nothing carries on', () => {
    const plan = planMonthClose([pending('power', 'AUTOMATIC', 300, 150)])
    expect(plan.autoPay[0].actualAmount.toString()).toBe('450')
    const closed = [{ entryId: 'power', status: 'PAID', scheduledAmount: d(300), carriedAmount: d(150), actualAmount: d(450) }]
    expect(carryFromClosedMonth(closed).size).toBe(0)
  })

  it('has nothing to do once every row is closed', () => {
    expect(planMonthClose([])).toEqual({ skip: [], autoPay: [] })
  })
})

describe('manual payment tracking (Average / Forward-looking)', () => {
  const bill = (over: Partial<Parameters<typeof trackingScheduledAmount>[0]> = {}) => ({
    frequency: 'MONTHLY' as const, startMonth: null, endMonth: null,
    monthlyEquivalent: d(300), amount: d(300), rateUsed: null, ...over,
  })

  it('is due the bill as charged: a quarterly bill in full in its months, nothing in between', () => {
    const water = bill({ frequency: 'QUARTERLY', amount: d(900), monthlyEquivalent: d(300) })
    expect(trackingScheduledAmount(water, 12)?.toString()).toBe('900')
    expect(trackingScheduledAmount(water, 11)).toBeNull()
  })

  it('follows the active months of a monthly bill', () => {
    const summer = bill({ startMonth: 6, endMonth: 8, monthlyEquivalent: d(75) }) // 300 × 3 / 12
    expect(trackingScheduledAmount(summer, 7)?.toString()).toBe('300')
    expect(trackingScheduledAmount(summer, 9)).toBeNull()
  })

  it('leaves dismissed rows alone when schedules change', () => {
    const plan = planOccurrenceSync(['gym'], [10], [{ id: 'o1', entryId: 'gym', month: 10, status: 'DISMISSED', scheduledAmount: d(100) }], () => d(150))
    expect(plan).toEqual({ create: [], update: [] })
  })

  it('keeps dismissed items in the Pay/No-pay transfer and never carries them over', () => {
    const rows = [
      { month: 10, status: 'DISMISSED', scheduledAmount: d(300), carriedAmount: d(0) },
      { month: 10, status: 'PENDING', scheduledAmount: d(100), carriedAmount: d(0) },
    ]
    expect(sumMonthObligations(rows).get(10)?.toString()).toBe('400')
    expect(carryFromClosedMonth([{ entryId: 'gym', status: 'DISMISSED', scheduledAmount: d(300), carriedAmount: d(0), actualAmount: null }]).size).toBe(0)
  })
})
