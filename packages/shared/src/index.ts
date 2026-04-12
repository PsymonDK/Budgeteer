// ── Payslip / deduction types ─────────────────────────────────────────────────

export interface BruttoItem {
  label: string
  monthlyAmount: number
}

export type PayslipLineType = 'benefit_in_kind' | 'pre_am' | 'am_bidrag' | 'a_skat' | 'post_tax'
export type SankeyGroup = 'brutto_benefits' | 'am_bidrag' | 'a_skat' | 'pension_employee' | 'atp' | 'other_deductions'

export interface PayslipLine {
  label: string
  amount: number
  type: PayslipLineType
  sankeyGroup?: SankeyGroup
  isCalculated: boolean
}

export interface PayslipExtraction {
  period: { year: number; month: number }
  employerName: string
  grossSalary: number
  netPay: number
  currency: string
  lines: PayslipLine[]
  pensionEmployerMonthly?: number
  reimbursements?: { label: string; amount: number }[]
  confidence: 'high' | 'medium' | 'low'
  notes?: string[]
}

export interface TaxCardSettingsData {
  traekprocent: number
  personfradragMonthly: number
  municipality?: string | null
  pensionEmployeePct?: number | null
  pensionEmployerPct?: number | null
  atpAmount?: number | null
  bruttoItems?: BruttoItem[] | null
}

// ── Danish tax calculation (for frontend live preview) ────────────────────────

export interface TaxCalcInput {
  traekprocent: number
  personfradragMonthly: number
  pensionEmployeePct?: number | null
  pensionEmployerPct?: number | null
  atpAmount?: number | null
  bruttoItems?: BruttoItem[] | null
}

export interface TaxCalcResult {
  lines: PayslipLine[]
  pensionEmployer: number
  net: number
  // Convenience fields for UI rendering (derived from lines)
  amBidrag: number
  aSkat: number
  topSkat: number
  atp: number
  pensionEmployee: number
  bruttoTotal: number
  isApproximate: true
}

// 2024 constants
const _TOP_SKAT_THRESHOLD = 49_075
const _TOP_SKAT_RATE = 0.15
const _AM_BIDRAG_RATE = 0.08
const _DEFAULT_ATP = 99

function _r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Calculate Danish payroll deductions for a given gross monthly salary.
 *
 * Correct calculation order (matching real Danish payroll):
 *   1. Pre-AM: bruttolønsordning + pension employee % + ATP → all reduce AM base
 *   2. AM-bidrag = 8% of AM-indkomst (truncated to whole DKK)
 *   3. A-skat = bottom tax + top-skat (both truncated to whole DKK)
 *   4. Net = gross − preAmTotal − amBidrag − aSkat
 */
export function calcDanishDeductions(gross: number, settings: TaxCalcInput): TaxCalcResult {
  const lines: PayslipLine[] = []

  // Pre-AM deductions
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = _r2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))
  for (const item of bruttoItems) {
    lines.push({ label: item.label, amount: item.monthlyAmount, type: 'pre_am', sankeyGroup: 'brutto_benefits', isCalculated: true })
  }

  const pensionEmployee = settings.pensionEmployeePct ? _r2(gross * settings.pensionEmployeePct / 100) : 0
  if (pensionEmployee > 0) {
    lines.push({ label: 'Pension (employee)', amount: pensionEmployee, type: 'pre_am', sankeyGroup: 'pension_employee', isCalculated: true })
  }

  const atp = Math.floor(settings.atpAmount ?? _DEFAULT_ATP)
  if (atp > 0) {
    lines.push({ label: 'ATP', amount: atp, type: 'pre_am', sankeyGroup: 'atp', isCalculated: true })
  }

  const preAmTotal = _r2(bruttoTotal + pensionEmployee + atp)

  // AM-bidrag — truncated to whole DKK
  const amBase = gross - preAmTotal
  const amBidrag = Math.floor(amBase * _AM_BIDRAG_RATE)
  lines.push({ label: 'AM-bidrag (8%)', amount: amBidrag, type: 'am_bidrag', sankeyGroup: 'am_bidrag', isCalculated: true })

  // A-skat — truncated to whole DKK
  const aIndkomst = amBase - amBidrag
  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = Math.floor(taxableBase * settings.traekprocent / 100)
  const topSkat = Math.floor(Math.max(0, aIndkomst - _TOP_SKAT_THRESHOLD) * _TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat
  lines.push({
    label: topSkat > 0 ? `A-skat (incl. top-skat ${topSkat})` : 'A-skat',
    amount: aSkat, type: 'a_skat', sankeyGroup: 'a_skat', isCalculated: true,
  })

  const pensionEmployer = settings.pensionEmployerPct ? _r2(gross * settings.pensionEmployerPct / 100) : 0
  const net = _r2(gross - preAmTotal - amBidrag - aSkat)

  return { lines, pensionEmployer, net, amBidrag, aSkat, topSkat, atp, pensionEmployee, bruttoTotal, isApproximate: true }
}

export const Frequency = {
  WEEKLY: 'WEEKLY',
  FORTNIGHTLY: 'FORTNIGHTLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  BIANNUAL: 'BIANNUAL',
  ANNUAL: 'ANNUAL'
} as const

export type FrequencyType = keyof typeof Frequency

export function calculateMonthlyEquivalent(
  amount: number,
  frequency: FrequencyType
): number {
  const multipliers: Record<FrequencyType, number> = {
    WEEKLY: 52 / 12,
    FORTNIGHTLY: 26 / 12,
    MONTHLY: 1,
    QUARTERLY: 1 / 3,
    BIANNUAL: 1 / 6,
    ANNUAL: 1 / 12
  }
  return Math.round(amount * multipliers[frequency] * 100) / 100
}