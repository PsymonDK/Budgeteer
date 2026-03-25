import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { calcMonthlyEquivalent, deriveBudgetStatus } from './calculations'

// ── calcMonthlyEquivalent ─────────────────────────────────────────────────────

describe('calcMonthlyEquivalent', () => {
  const d = (v: string) => new Decimal(v)

  it('MONTHLY returns amount unchanged', () => {
    expect(calcMonthlyEquivalent(d('1200'), 'MONTHLY').toNumber()).toBeCloseTo(1200, 2)
  })

  it('WEEKLY × 52 / 12', () => {
    // 100/week → 100 * 52 / 12 = 433.33...
    expect(calcMonthlyEquivalent(d('100'), 'WEEKLY').toNumber()).toBeCloseTo(433.33, 1)
  })

  it('FORTNIGHTLY × 26 / 12', () => {
    // 200/fortnight → 200 * 26 / 12 = 433.33...
    expect(calcMonthlyEquivalent(d('200'), 'FORTNIGHTLY').toNumber()).toBeCloseTo(433.33, 1)
  })

  it('QUARTERLY ÷ 3', () => {
    // 300/quarter → 100/month
    expect(calcMonthlyEquivalent(d('300'), 'QUARTERLY').toNumber()).toBeCloseTo(100, 2)
  })

  it('BIANNUAL ÷ 6', () => {
    // 600 every 6 months → 100/month
    expect(calcMonthlyEquivalent(d('600'), 'BIANNUAL').toNumber()).toBeCloseTo(100, 2)
  })

  it('ANNUAL ÷ 12', () => {
    // 1200/year → 100/month
    expect(calcMonthlyEquivalent(d('1200'), 'ANNUAL').toNumber()).toBeCloseTo(100, 2)
  })

  it('handles decimal amounts precisely', () => {
    // 52.50/week → 52.50 * 52 / 12 = 227.50
    expect(calcMonthlyEquivalent(d('52.50'), 'WEEKLY').toNumber()).toBeCloseTo(227.5, 2)
  })

  it('handles zero amount', () => {
    expect(calcMonthlyEquivalent(d('0'), 'MONTHLY').toNumber()).toBe(0)
  })
})

// ── deriveBudgetStatus ────────────────────────────────────────────────────────

describe('deriveBudgetStatus', () => {
  const currentYear = new Date().getFullYear()

  it('current year → ACTIVE', () => {
    expect(deriveBudgetStatus(currentYear)).toBe('ACTIVE')
  })

  it('next year → FUTURE', () => {
    expect(deriveBudgetStatus(currentYear + 1)).toBe('FUTURE')
  })

  it('far future year → FUTURE', () => {
    expect(deriveBudgetStatus(currentYear + 5)).toBe('FUTURE')
  })

  it('last year → RETIRED', () => {
    expect(deriveBudgetStatus(currentYear - 1)).toBe('RETIRED')
  })

  it('far past year → RETIRED', () => {
    expect(deriveBudgetStatus(currentYear - 10)).toBe('RETIRED')
  })
})
