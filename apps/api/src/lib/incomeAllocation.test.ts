import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { AllocationYearRow, findOverAllocations, pickReportingYear, summarizeAllocatedIncome } from './incomeAllocation'

const d = (v: string | number) => new Decimal(v)
const row = (jobId: string, pct: number, year: number, status = 'ACTIVE'): AllocationYearRow => ({
  jobId, allocationPct: d(pct), budgetYear: { year, status },
})

describe('findOverAllocations', () => {
  it('100% this year plus 100% next year is not over-allocated', () => {
    expect(findOverAllocations([row('job', 100, 2026, 'ACTIVE'), row('job', 100, 2027, 'FUTURE')])).toEqual([])
  })

  it('flags a job allocated over 100% across households in the same year', () => {
    const over = findOverAllocations([
      row('job', 60, 2026), // household A
      row('job', 50, 2026), // household B
      row('job', 100, 2027, 'FUTURE'),
    ])
    expect(over).toHaveLength(1)
    expect(over[0].jobId).toBe('job')
    expect(over[0].year).toBe(2026)
    expect(over[0].totalPct.toNumber()).toBe(110)
  })

  it('evaluates each job separately', () => {
    // job-a at 150% must be flagged even though job-b is unallocated
    const over = findOverAllocations([row('job-a', 100, 2026), row('job-a', 50, 2026), row('job-b', 0, 2026)])
    expect(over.map((o) => o.jobId)).toEqual(['job-a'])
  })

  it('exactly 100% is fine', () => {
    expect(findOverAllocations([row('job', 40, 2026), row('job', 60, 2026)])).toEqual([])
  })

  it('ignores retired years and simulations', () => {
    expect(findOverAllocations([
      row('job', 100, 2026, 'ACTIVE'),
      row('job', 100, 2026, 'SIMULATION'),
      row('job', 100, 2026, 'RETIRED'),
    ])).toEqual([])
  })
})

describe('pickReportingYear', () => {
  it('prefers the active year over earlier-sorting future years', () => {
    expect(pickReportingYear([row('job', 100, 2027, 'FUTURE'), row('job', 100, 2026, 'ACTIVE')])).toEqual({ year: 2026, status: 'ACTIVE' })
  })

  it('falls back to the earliest future year', () => {
    expect(pickReportingYear([row('job', 100, 2028, 'FUTURE'), row('job', 100, 2027, 'FUTURE')])?.year).toBe(2027)
  })

  it('returns null without live allocations', () => {
    expect(pickReportingYear([row('job', 100, 2025, 'RETIRED')])).toBeNull()
  })
})

describe('summarizeAllocatedIncome', () => {
  const incomes = new Map([['job-a', d(30000)], ['job-b', d(10000)]])

  it('counts only the requested year', () => {
    const s = summarizeAllocatedIncome(
      [row('job-a', 100, 2026), row('job-a', 100, 2027, 'FUTURE'), row('job-b', 50, 2026)],
      2026,
      incomes,
    )
    expect(s.totalMonthly.toNumber()).toBe(40000)
    expect(s.totalAllocated.toNumber()).toBe(35000)
    expect(s.totalUnallocated.toNumber()).toBe(5000)
    expect(s.allocationPct.toNumber()).toBe(87.5)
  })

  it('reports 0% when there is no income', () => {
    const s = summarizeAllocatedIncome([row('job-a', 100, 2026)], 2026, new Map([['job-a', d(0)]]))
    expect(s.allocationPct.toNumber()).toBe(0)
  })
})
