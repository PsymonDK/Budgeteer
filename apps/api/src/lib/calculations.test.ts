import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { calcMonthlyEquivalent, calcForwardMonthlyNeed, deriveBudgetStatus } from './calculations'

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

// ── calcForwardMonthlyNeed ────────────────────────────────────────────────────

describe('calcForwardMonthlyNeed', () => {
  const d = (v: string) => new Decimal(v)

  // expenses with monthlyEquivalent of 100 → annualNeed = 100 * 12 = 1200
  const expenses100 = [{ monthlyEquivalent: d('100') }]
  const noPaid: { actualAmount: Decimal | null }[] = []

  it('January (month 1), no paid → annualNeed / 12', () => {
    // remainingMonths = 13 - 1 = 12; result = 1200 / 12 = 100
    expect(calcForwardMonthlyNeed(expenses100, noPaid, 1).toNumber()).toBeCloseTo(100, 2)
  })

  it('July (month 7), no paid → annualNeed / 6', () => {
    // remainingMonths = 13 - 7 = 6; result = 1200 / 6 = 200
    expect(calcForwardMonthlyNeed(expenses100, noPaid, 7).toNumber()).toBeCloseTo(200, 2)
  })

  it('month 12, no paid → full annualNeed (remainingMonths = 1)', () => {
    // remainingMonths = 13 - 12 = 1; result = 1200 / 1 = 1200
    expect(calcForwardMonthlyNeed(expenses100, noPaid, 12).toNumber()).toBeCloseTo(1200, 2)
  })

  it('all transfers already paid (total = annualNeed) → 0', () => {
    const paid = [{ actualAmount: d('1200') }]
    expect(calcForwardMonthlyNeed(expenses100, paid, 1).toNumber()).toBe(0)
  })

  it('multiple paid transfers are correctly subtracted', () => {
    // annualNeed = 1200, paid = 300 + 200 = 500, remaining = 700, remainingMonths = 6
    const paid = [{ actualAmount: d('300') }, { actualAmount: d('200') }]
    expect(calcForwardMonthlyNeed(expenses100, paid, 7).toNumber()).toBeCloseTo(700 / 6, 2)
  })

  it('result never goes negative when paid exceeds annualNeed', () => {
    const paid = [{ actualAmount: d('2000') }]
    expect(calcForwardMonthlyNeed(expenses100, paid, 6).toNumber()).toBe(0)
  })

  it('null actualAmount in paid transfers is treated as 0', () => {
    const paid = [{ actualAmount: null }, { actualAmount: d('600') }]
    // alreadyPaid = 600, remaining = 600, remainingMonths = 12
    expect(calcForwardMonthlyNeed(expenses100, paid, 1).toNumber()).toBeCloseTo(50, 2)
  })

  it('no expenses → 0 regardless of month', () => {
    expect(calcForwardMonthlyNeed([], noPaid, 6).toNumber()).toBe(0)
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
