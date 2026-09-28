import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  BonusData,
  budgetMonthlyIncomeForJob,
  buildIncomeHistory,
  HistoryJob,
  isJobActiveInMonth,
  monthlyIncomeForJob,
  pickTaxCardAt,
  salaryForMonth,
  SalaryRecordData,
  TaxCardData,
} from './jobIncome'
import { calcDanishDeductions } from './taxCalcDK'

const d = (v: string | number) => new Decimal(v)
const date = (iso: string) => new Date(iso) // 'YYYY-MM-DD' → UTC midnight, like stored values

function salary(effectiveFrom: string, gross: number, net: number, extra: Partial<SalaryRecordData> = {}): SalaryRecordData {
  return { effectiveFrom: date(effectiveFrom), grossAmount: d(gross), netAmount: d(net), rateUsed: null, deductionsSource: 'MANUAL', ...extra }
}

function bonus(id: string, paymentDate: string, gross: number, net: number, extra: Partial<BonusData> = {}): BonusData {
  return {
    id, label: id, paymentDate: date(paymentDate), grossAmount: d(gross), netAmount: d(net),
    includeInBudget: true, budgetMode: 'ONE_OFF', rateUsed: null, ...extra,
  }
}

function job(extra: Partial<HistoryJob> = {}): HistoryJob {
  return {
    id: 'job-1', name: 'Job', country: 'SE', startDate: date('2020-01-01'), endDate: null,
    salaryRecords: [salary('2020-01-01', 30000, 20000)], overrides: [], bonuses: [], ...extra,
  }
}

function taxCard(effectiveFrom: string, traekprocent: number): TaxCardData {
  return {
    effectiveFrom: date(effectiveFrom), traekprocent: d(traekprocent), personfradragMonthly: d(4000),
    pensionEmployeePct: null, pensionEmployerPct: null, atpAmount: null, bruttoItems: null,
  }
}

// ── Salary and overrides ──────────────────────────────────────────────────────

describe('salaryForMonth', () => {
  it('uses the latest salary record effective in or before the month', () => {
    const j = job({ salaryRecords: [salary('2025-01-01', 30000, 20000), salary('2026-04-01', 33000, 22000)] })
    expect(salaryForMonth(j, 2026, 3).gross.toNumber()).toBe(30000)
    expect(salaryForMonth(j, 2026, 4).gross.toNumber()).toBe(33000)
    expect(salaryForMonth(j, 2026, 4).net.toNumber()).toBe(22000)
  })

  it('a monthly override beats the salary record for that month only', () => {
    const j = job({
      overrides: [{ year: 2026, month: 6, grossAmount: d(45000), netAmount: d(28000), deductionsSource: 'MANUAL' }],
    })
    expect(salaryForMonth(j, 2026, 6).gross.toNumber()).toBe(45000)
    expect(salaryForMonth(j, 2026, 6).source).toBe('override')
    expect(salaryForMonth(j, 2026, 7).gross.toNumber()).toBe(30000)
  })

  it('returns zero when there is no salary record yet', () => {
    const j = job({ salaryRecords: [salary('2026-05-01', 30000, 20000)] })
    expect(salaryForMonth(j, 2026, 4).gross.toNumber()).toBe(0)
    expect(salaryForMonth(j, 2026, 4).source).toBe('none')
  })
})

// ── FX conversion ─────────────────────────────────────────────────────────────

describe('FX conversion to base currency', () => {
  it('multiplies salary gross and net by the record rateUsed', () => {
    const j = job({ salaryRecords: [salary('2026-01-01', 5000, 3500, { rateUsed: d('7.46') })] })
    const income = monthlyIncomeForJob(j, 2026, 3)
    expect(income.gross.toNumber()).toBeCloseTo(37300, 2)
    expect(income.net.toNumber()).toBeCloseTo(26110, 2)
  })

  it('treats a record without rateUsed as base currency', () => {
    expect(monthlyIncomeForJob(job(), 2026, 3).gross.toNumber()).toBe(30000)
  })

  it('converts bonuses with the bonus rateUsed', () => {
    const j = job({ bonuses: [bonus('b1', '2026-03-10', 1000, 600, { rateUsed: d('7.5') })] })
    const income = monthlyIncomeForJob(j, 2026, 3)
    expect(income.bonusGross.toNumber()).toBeCloseTo(7500, 2)
    expect(income.bonusNet.toNumber()).toBeCloseTo(4500, 2)
  })

  it('does not convert overrides (stored in base currency)', () => {
    const j = job({
      salaryRecords: [salary('2026-01-01', 5000, 3500, { rateUsed: d('7.46') })],
      overrides: [{ year: 2026, month: 3, grossAmount: d(40000), netAmount: d(27000), deductionsSource: 'MANUAL' }],
    })
    expect(monthlyIncomeForJob(j, 2026, 3).gross.toNumber()).toBe(40000)
  })
})

// ── Job start / end dates ─────────────────────────────────────────────────────

describe('job start and end dates', () => {
  const j = job({ startDate: date('2026-03-15'), endDate: date('2026-08-20') })

  it('is active from the start month through the end month', () => {
    expect(isJobActiveInMonth(j, 2026, 2)).toBe(false)
    expect(isJobActiveInMonth(j, 2026, 3)).toBe(true)
    expect(isJobActiveInMonth(j, 2026, 8)).toBe(true)
    expect(isJobActiveInMonth(j, 2026, 9)).toBe(false)
  })

  it('an ended job earns nothing after its end month', () => {
    expect(monthlyIncomeForJob(j, 2026, 8).gross.toNumber()).toBe(30000)
    const after = monthlyIncomeForJob(j, 2026, 9)
    expect(after.gross.toNumber()).toBe(0)
    expect(after.active).toBe(false)
  })

  it('earns nothing before its start month', () => {
    expect(monthlyIncomeForJob(j, 2026, 2).gross.toNumber()).toBe(0)
  })

  it('ignores overrides outside the active months', () => {
    const withOverride = job({
      endDate: date('2026-05-31'),
      overrides: [{ year: 2026, month: 7, grossAmount: d(1000), netAmount: d(800), deductionsSource: 'MANUAL' }],
    })
    expect(monthlyIncomeForJob(withOverride, 2026, 7).gross.toNumber()).toBe(0)
  })

  it('drops bonuses paid after the job ended', () => {
    const ended = job({ endDate: date('2026-05-31'), bonuses: [bonus('late', '2026-12-15', 10000, 6000)] })
    expect(monthlyIncomeForJob(ended, 2026, 12).bonusGross.toNumber()).toBe(0)
    expect(budgetMonthlyIncomeForJob(ended, { year: 2026, status: 'ACTIVE' }, { year: 2026, month: 3 }).bonusGross.toNumber()).toBe(0)
  })
})

// ── Bonuses ───────────────────────────────────────────────────────────────────

describe('bonuses in a month (budget counting)', () => {
  it('SPREAD_ANNUALLY adds net/12 to every month of the payment year', () => {
    const j = job({ bonuses: [bonus('b', '2026-03-31', 12000, 6000, { budgetMode: 'SPREAD_ANNUALLY' })] })
    for (const m of [1, 3, 12]) {
      const income = monthlyIncomeForJob(j, 2026, m)
      expect(income.bonusNet.toNumber()).toBeCloseTo(500, 6)
      expect(income.bonusGross.toNumber()).toBeCloseTo(1000, 6)
    }
    expect(monthlyIncomeForJob(j, 2027, 1).bonusNet.toNumber()).toBe(0)
    expect(monthlyIncomeForJob(j, 2025, 12).bonusNet.toNumber()).toBe(0)
  })

  it('ONE_OFF adds the full amount to the payment month only', () => {
    const j = job({ bonuses: [bonus('b', '2026-06-15', 12000, 6000, { budgetMode: 'ONE_OFF' })] })
    expect(monthlyIncomeForJob(j, 2026, 6).bonusNet.toNumber()).toBe(6000)
    expect(monthlyIncomeForJob(j, 2026, 6).net.toNumber()).toBe(26000)
    expect(monthlyIncomeForJob(j, 2026, 5).bonusNet.toNumber()).toBe(0)
    expect(monthlyIncomeForJob(j, 2026, 7).bonusNet.toNumber()).toBe(0)
  })

  it('excluded bonuses (includeInBudget=false) never count in budget views', () => {
    const j = job({ bonuses: [bonus('b', '2026-06-15', 12000, 6000, { includeInBudget: false, budgetMode: null })] })
    expect(monthlyIncomeForJob(j, 2026, 6).bonusNet.toNumber()).toBe(0)
    expect(budgetMonthlyIncomeForJob(j, { year: 2026, status: 'ACTIVE' }, { year: 2026, month: 6 }).bonusNet.toNumber()).toBe(0)
  })

  it('cash counting includes every bonus in full in its payment month', () => {
    const j = job({
      bonuses: [
        bonus('excluded', '2026-06-15', 1000, 600, { includeInBudget: false, budgetMode: null }),
        bonus('spread', '2026-06-20', 1200, 900, { budgetMode: 'SPREAD_ANNUALLY' }),
      ],
    })
    const june = monthlyIncomeForJob(j, 2026, 6, 'cash')
    expect(june.bonusGross.toNumber()).toBe(2200)
    expect(june.bonuses.map((b) => b.bonusId)).toEqual(['excluded', 'spread'])
    expect(monthlyIncomeForJob(j, 2026, 7, 'cash').bonusGross.toNumber()).toBe(0)
  })

  it("'none' counting leaves bonuses out", () => {
    const j = job({ bonuses: [bonus('b', '2026-06-15', 12000, 6000)] })
    expect(monthlyIncomeForJob(j, 2026, 6, 'none').gross.toNumber()).toBe(30000)
  })
})

// ── Budget-year income ────────────────────────────────────────────────────────

describe('budgetMonthlyIncomeForJob', () => {
  it('adds included bonuses of the budget year as a yearly average (both modes ÷12)', () => {
    const j = job({
      bonuses: [
        bonus('one-off', '2026-06-15', 12000, 6000, { budgetMode: 'ONE_OFF' }),
        bonus('spread', '2026-03-01', 24000, 12000, { budgetMode: 'SPREAD_ANNUALLY' }),
        bonus('excluded', '2026-03-01', 99999, 99999, { includeInBudget: false, budgetMode: null }),
        bonus('other-year', '2027-03-01', 12000, 12000, { budgetMode: 'SPREAD_ANNUALLY' }),
      ],
    })
    const income = budgetMonthlyIncomeForJob(j, { year: 2026, status: 'ACTIVE' }, { year: 2026, month: 9 })
    expect(income.salaryNet.toNumber()).toBe(20000)
    expect(income.bonusNet.toNumber()).toBeCloseTo(1500, 6) // (6000 + 12000) / 12
    expect(income.net.toNumber()).toBeCloseTo(21500, 6)
    expect(income.bonusGross.toNumber()).toBeCloseTo(3000, 6) // (12000 + 24000) / 12
  })

  it('uses the salary at the reference month for ACTIVE/FUTURE years', () => {
    const j = job({ salaryRecords: [salary('2026-01-01', 30000, 20000), salary('2026-07-01', 36000, 24000)] })
    expect(budgetMonthlyIncomeForJob(j, { year: 2026, status: 'FUTURE' }, { year: 2026, month: 1 }).gross.toNumber()).toBe(30000)
    expect(budgetMonthlyIncomeForJob(j, { year: 2026, status: 'ACTIVE' }, { year: 2026, month: 9 }).gross.toNumber()).toBe(36000)
  })

  it('averages the twelve months for RETIRED years', () => {
    // Six months at 30000, job ends in June → 15000/month for the year
    const j = job({ endDate: date('2025-06-30') })
    const income = budgetMonthlyIncomeForJob(j, { year: 2025, status: 'RETIRED' }, { year: 2025, month: 12 })
    expect(income.salaryGross.toNumber()).toBeCloseTo(15000, 6)
  })

  it('RETIRED average counts a ONE_OFF bonus once (amount / 12)', () => {
    const j = job({ bonuses: [bonus('b', '2025-06-15', 12000, 6000)] })
    const income = budgetMonthlyIncomeForJob(j, { year: 2025, status: 'RETIRED' }, { year: 2025, month: 12 })
    expect(income.bonusNet.toNumber()).toBeCloseTo(500, 6)
    expect(income.net.toNumber()).toBeCloseTo(20500, 6)
  })
})

// ── Tax cards ─────────────────────────────────────────────────────────────────

describe('pickTaxCardAt', () => {
  const cards = [taxCard('2025-01-01', 36), taxCard('2026-01-01', 38), taxCard('2027-01-01', 40)]

  it('picks the card effective at the given date, not the latest one', () => {
    expect(pickTaxCardAt(cards, date('2025-06-01'))?.traekprocent.toNumber()).toBe(36)
    expect(pickTaxCardAt(cards, date('2026-01-01'))?.traekprocent.toNumber()).toBe(38)
    expect(pickTaxCardAt(cards, date('2027-03-01'))?.traekprocent.toNumber()).toBe(40)
  })

  it('returns null before the first card', () => {
    expect(pickTaxCardAt(cards, date('2024-12-31'))).toBeNull()
  })

  it('does not depend on input order', () => {
    expect(pickTaxCardAt([...cards].reverse(), date('2026-06-01'))?.traekprocent.toNumber()).toBe(38)
  })
})

describe('stale net recalculation (deductionsSource = null, DK)', () => {
  it("recalculates net with the tax card effective in the income month", () => {
    const j = job({
      country: 'DK',
      salaryRecords: [salary('2025-01-01', 40000, 1, { deductionsSource: null })],
      taxCardSettings: [taxCard('2025-01-01', 36), taxCard('2026-01-01', 40)],
    })
    const card2025 = { traekprocent: 36, personfradragMonthly: 4000 }
    const card2026 = { traekprocent: 40, personfradragMonthly: 4000 }
    expect(salaryForMonth(j, 2025, 6).net.toNumber()).toBeCloseTo(calcDanishDeductions(40000, card2025).net, 2)
    expect(salaryForMonth(j, 2026, 6).net.toNumber()).toBeCloseTo(calcDanishDeductions(40000, card2026).net, 2)
  })

  it('keeps the stored net when deductions were calculated or entered', () => {
    const j = job({ country: 'DK', taxCardSettings: [taxCard('2020-01-01', 36)] })
    expect(salaryForMonth(j, 2026, 6).net.toNumber()).toBe(20000)
  })
})

// ── Income history ────────────────────────────────────────────────────────────

describe('buildIncomeHistory', () => {
  it('monthly buckets spread SPREAD_ANNUALLY bonuses ÷12 and keep ONE_OFF in its month', () => {
    const j = job({
      bonuses: [
        bonus('spread', '2026-03-15', 12000, 6000, { budgetMode: 'SPREAD_ANNUALLY' }),
        bonus('oneoff', '2026-02-10', 2400, 1200, { budgetMode: 'ONE_OFF' }),
      ],
    })
    const buckets = buildIncomeHistory([j], { year: 2026, month: 1 }, { year: 2026, month: 3 }, 'monthly')
    expect(buckets.map((b) => b.period)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(buckets[0].net).toBe(20500)
    expect(buckets[1].net).toBe(21700)
    expect(buckets[1].bonuses).toEqual([
      { jobId: 'job-1', label: 'spread', gross: 1000, net: 500 },
      { jobId: 'job-1', label: 'oneoff', gross: 2400, net: 1200 },
    ])
    expect(buckets[2].perJob).toEqual([{ jobId: 'job-1', jobName: 'Job', gross: 30000, net: 20000 }])
    expect(buckets[2].total).toBe(buckets[2].net)
  })

  it('quarterly and yearly buckets sum every month in the period', () => {
    const j = job({ bonuses: [bonus('spread', '2026-05-01', 12000, 12000, { budgetMode: 'SPREAD_ANNUALLY' })] })
    const quarters = buildIncomeHistory([j], { year: 2026, month: 1 }, { year: 2026, month: 12 }, 'quarterly')
    expect(quarters.map((b) => b.period)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'])
    expect(quarters[0].net).toBe(3 * 20000 + 3 * 1000)
    const years = buildIncomeHistory([j], { year: 2026, month: 1 }, { year: 2026, month: 12 }, 'yearly')
    expect(years).toHaveLength(1)
    expect(years[0].net).toBe(12 * 20000 + 12000)
    expect(years[0].bonuses).toEqual([{ jobId: 'job-1', label: 'spread', gross: 12000, net: 12000 }])
  })

  it('converts FX and leaves ended jobs out of later buckets', () => {
    const eur = job({ id: 'eur', name: 'EUR job', salaryRecords: [salary('2026-01-01', 1000, 800, { rateUsed: d('7.5') })], endDate: date('2026-01-31') })
    const buckets = buildIncomeHistory([eur], { year: 2026, month: 1 }, { year: 2026, month: 2 }, 'monthly')
    expect(buckets[0].gross).toBe(7500)
    expect(buckets[0].net).toBe(6000)
    expect(buckets[1].gross).toBe(0)
    expect(buckets[1].perJob).toEqual([])
  })
})
