import { describe, it, expect } from 'vitest'
import { nextBudgetStatus } from './budgetYearLifecycle'
import { previousMonth } from './automations'

describe('nextBudgetStatus', () => {
  it('retires past years and activates the current FUTURE year', () => {
    expect(nextBudgetStatus('ACTIVE', 2026, 2027)).toBe('RETIRED')
    expect(nextBudgetStatus('FUTURE', 2026, 2027)).toBe('RETIRED')
    expect(nextBudgetStatus('FUTURE', 2027, 2027)).toBe('ACTIVE')
  })

  it('moves a future year that is ACTIVE ahead of time back to FUTURE', () => {
    expect(nextBudgetStatus('ACTIVE', 2028, 2027)).toBe('FUTURE')
  })

  it('leaves correct, retired, and simulation years alone', () => {
    expect(nextBudgetStatus('ACTIVE', 2027, 2027)).toBeNull()
    expect(nextBudgetStatus('FUTURE', 2028, 2027)).toBeNull()
    expect(nextBudgetStatus('RETIRED', 2027, 2027)).toBeNull()
    expect(nextBudgetStatus('SIMULATION', 2020, 2027)).toBeNull()
  })
})

describe('previousMonth', () => {
  it('wraps to December of the previous year in January', () => {
    expect(previousMonth(new Date(2027, 0, 1))).toEqual({ year: 2026, month: 12 })
    expect(previousMonth(new Date(2026, 8, 1))).toEqual({ year: 2026, month: 8 })
  })
})
