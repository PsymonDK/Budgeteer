import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { calcMonthlyEquivalent, calcForwardMonthlyNeed, deriveBudgetStatus, calcMonthlyInBase, expenseMonthSchedule } from './calculations'

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

  // Full-year expense: monthlyEquivalent = 100 (= monthly cost, no annual-average reduction)
  const fullYear = [{ monthlyEquivalent: d('100'), startMonth: null, endMonth: null }]

  it('full-year expense: forward amount equals monthly cost regardless of current month', () => {
    // monthlyWhenActive = 100, all remaining months active → always 100/month
    expect(calcForwardMonthlyNeed(fullYear, 1).toNumber()).toBeCloseTo(100, 2)
    expect(calcForwardMonthlyNeed(fullYear, 6).toNumber()).toBeCloseTo(100, 2)
    expect(calcForwardMonthlyNeed(fullYear, 12).toNumber()).toBeCloseTo(100, 2)
  })

  it('no expenses → 0 regardless of month', () => {
    expect(calcForwardMonthlyNeed([], 6).toNumber()).toBe(0)
  })

  it('expense already ended (endMonth < currentMonth) → contributes 0', () => {
    // Expense active months 1–3, current month is 4
    const pastExpense = [{ monthlyEquivalent: d('25'), startMonth: 1, endMonth: 3 }]
    // monthlyWhenActive = 25 × 12 / 3 = 100, but start=max(1,4)=4 > end=3 → skipped
    expect(calcForwardMonthlyNeed(pastExpense, 4).toNumber()).toBe(0)
  })

  it('expense ending in same month as currentMonth → counts 1 remaining month', () => {
    // Expense months 1–4, current month 4: 1 remaining active month at 100/month
    // monthlyWhenActive = (25 × 12 / 4) = 75; remainingNeed = 75 × 1 = 75; remainingMonths = 9
    const expense = [{ monthlyEquivalent: d('25'), startMonth: 1, endMonth: 4 }]
    expect(calcForwardMonthlyNeed(expense, 4).toNumber()).toBeCloseTo(75 / 9, 2)
  })

  it('expense starting in the future: only counts months from its startMonth', () => {
    // Expense months 7–12 (6 months), current month 4
    // monthlyEquivalent stored as annualAverage = 600 × 6/12 = 300
    // monthlyWhenActive = 300 × 12 / 6 = 600
    // activeRemaining = 12 - 7 + 1 = 6; remainingNeed = 600 × 6 = 3600
    // remainingMonths = 13 - 4 = 9; forwardAmount = 3600 / 9 = 400
    const futureExpense = [{ monthlyEquivalent: d('300'), startMonth: 7, endMonth: 12 }]
    expect(calcForwardMonthlyNeed(futureExpense, 4).toNumber()).toBeCloseTo(400, 2)
  })

  it('loan split: Loan A months 1–4, Loan B months 5–12, current month 4', () => {
    // Loan A: monthlyWhenActive = (333.33 × 12 / 4) = 1000; activeRemaining = 1; cost = 1000
    // Loan B: monthlyWhenActive = (733.33 × 12 / 8) = 1100; activeRemaining = 8; cost = 8800
    // remainingNeed = 9800; remainingMonths = 9; forwardAmount = 9800/9 ≈ 1088.89
    const loanA = { monthlyEquivalent: d('333.33'), startMonth: 1, endMonth: 4 }
    const loanB = { monthlyEquivalent: d('733.33'), startMonth: 5, endMonth: 12 }
    expect(calcForwardMonthlyNeed([loanA, loanB], 4).toNumber()).toBeCloseTo(9800 / 9, 1)
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

// ── calcMonthlyInBase ─────────────────────────────────────────────────────────

describe('calcMonthlyInBase', () => {
  it('converts, normalises frequency and averages partial years like save-time', () => {
    // 100 EUR monthly for June–August at 7.46: 746/month active → 186.50 annual average
    expect(calcMonthlyInBase('100', '7.46', 'MONTHLY', 6, 8).toFixed(2)).toBe('186.50')
  })

  it('handles full-year entries and non-monthly frequencies', () => {
    expect(calcMonthlyInBase('1200', '1', 'ANNUAL').toFixed(2)).toBe('100.00')
    expect(calcMonthlyInBase('300', '2', 'QUARTERLY').toFixed(2)).toBe('200.00')
  })
})

// ── expenseMonthSchedule ──────────────────────────────────────────────────────

describe('expenseMonthSchedule', () => {
  const base = { startMonth: null, endMonth: null, rateUsed: null }
  const d = (v: string) => new Decimal(v)

  it('spreads recurring expenses over the active months', () => {
    const s = expenseMonthSchedule({ ...base, frequency: 'MONTHLY', startMonth: 6, endMonth: 8, monthlyEquivalent: d('250'), amount: d('1000') })
    expect(s).toEqual([null, null, null, null, null, '1000.00', '1000.00', '1000.00', null, null, null, null])
  })

  it('puts quarterly lump sums on quarter ends at the exact converted amount', () => {
    const s = expenseMonthSchedule({ ...base, frequency: 'QUARTERLY', monthlyEquivalent: d('333.33'), amount: d('134'), rateUsed: d('7.4627') })
    expect(s.filter(Boolean)).toEqual(['1000.00', '1000.00', '1000.00', '1000.00'])
    expect(s[2]).toBe('1000.00')
    expect(s[0]).toBeNull()
  })

  it('places annual and biannual amounts in their months', () => {
    expect(expenseMonthSchedule({ ...base, frequency: 'ANNUAL', endMonth: 10, monthlyEquivalent: d('100'), amount: d('1200') })[9]).toBe('1200.00')
    const bi = expenseMonthSchedule({ ...base, frequency: 'BIANNUAL', startMonth: 7, monthlyEquivalent: d('50'), amount: d('600') })
    expect(bi[5]).toBeNull()
    expect(bi[11]).toBe('600.00')
  })
})
