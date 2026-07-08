import { describe, expect, it } from 'vitest'
import { pickDefaultBudgetYear } from './budgetYearSelection'

describe('pickDefaultBudgetYear', () => {
  it('prefers the active year over future years', () => {
    const selected = pickDefaultBudgetYear([
      { id: 'future-2027', year: 2027, status: 'FUTURE' },
      { id: 'active-2026', year: 2026, status: 'ACTIVE' },
    ])

    expect(selected?.id).toBe('active-2026')
  })

  it('uses the earliest future year when there is no active year', () => {
    const selected = pickDefaultBudgetYear([
      { id: 'future-2028', year: 2028, status: 'FUTURE' },
      { id: 'future-2027', year: 2027, status: 'FUTURE' },
    ])

    expect(selected?.id).toBe('future-2027')
  })

  it('ignores retired years and simulations for default dashboards', () => {
    const selected = pickDefaultBudgetYear([
      { id: 'retired-2025', year: 2025, status: 'RETIRED' },
      { id: 'simulation-2026', year: 2026, status: 'SIMULATION' },
    ])

    expect(selected).toBeNull()
  })
})
