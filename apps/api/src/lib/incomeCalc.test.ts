import { describe, it, expect, vi } from 'vitest'

vi.mock('./prisma', () => ({ prisma: {} }))

import { Decimal } from '@prisma/client/runtime/client'
import { aggregateAllocatedIncome } from './incomeCalc'
import { JobIncomeData } from './jobIncome'

const d = (v: string | number) => new Decimal(v)

function job(id: string, gross: number, net: number, extra: Partial<JobIncomeData> = {}): JobIncomeData {
  return {
    id, country: 'SE', startDate: new Date('2020-01-01'), endDate: null,
    salaryRecords: [{ effectiveFrom: new Date('2020-01-01'), grossAmount: d(gross), netAmount: d(net), rateUsed: null, deductionsSource: 'MANUAL' }],
    overrides: [], bonuses: [], ...extra,
  }
}

describe('aggregateAllocatedIncome', () => {
  const ref = { year: 2026, month: 9 }
  const active = { year: 2026, status: 'ACTIVE' }

  it('applies allocation % per job and groups by member', () => {
    const result = aggregateAllocatedIncome([
      { job: job('a1', 40000, 30000), userId: 'alice', allocationPct: d(100) },
      { job: job('a2', 10000, 8000), userId: 'alice', allocationPct: d(50) },
      { job: job('b1', 20000, 15000), userId: 'bob', allocationPct: d(75) },
    ], active, ref)
    expect(result.totalMonthlyGross.toNumber()).toBe(40000 + 5000 + 15000)
    expect(result.totalMonthlyNet.toNumber()).toBe(30000 + 4000 + 11250)
    const alice = result.members.find((m) => m.userId === 'alice')!
    expect(alice.monthlyAllocatedGross.toNumber()).toBe(45000)
    expect(result.allocations[2].allocatedNet.toNumber()).toBe(11250)
  })

  it('includes budget bonuses as a yearly average', () => {
    const withBonus = job('a1', 40000, 30000, {
      bonuses: [{
        id: 'b', label: 'Bonus', paymentDate: new Date('2026-03-01'), grossAmount: d(24000), netAmount: d(12000),
        includeInBudget: true, budgetMode: 'SPREAD_ANNUALLY', rateUsed: null,
      }],
    })
    const result = aggregateAllocatedIncome([{ job: withBonus, userId: 'alice', allocationPct: d(50) }], active, ref)
    expect(result.totalMonthlyNet.toNumber()).toBe((30000 + 1000) / 2)
    expect(result.totalMonthlyGross.toNumber()).toBe((40000 + 2000) / 2)
  })

  it('an ended job contributes nothing to a later budget year', () => {
    const ended = job('a1', 40000, 30000, { endDate: new Date('2025-12-31') })
    const result = aggregateAllocatedIncome([{ job: ended, userId: 'alice', allocationPct: d(100) }], active, ref)
    expect(result.totalMonthlyGross.toNumber()).toBe(0)
  })

  it('returns zero totals without allocations', () => {
    const result = aggregateAllocatedIncome([], active, ref)
    expect(result.totalMonthlyGross.isZero()).toBe(true)
    expect(result.members).toEqual([])
  })
})
