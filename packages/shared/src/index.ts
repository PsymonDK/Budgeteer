// ── Payslip / deduction types ─────────────────────────────────────────────────

export interface BruttoItem {
  label: string
  monthlyAmount: number
}

export interface OtherDeductionItem {
  label: string
  amount: number
}

/** Payslip deduction breakdown — present on SalaryRecord and MonthlyIncomeOverride */
export interface DeductionFields {
  amBidragAmount?: number | null
  aSkattAmount?: number | null
  pensionEmployeeAmount?: number | null
  pensionEmployerAmount?: number | null
  atpAmount?: number | null
  bruttoDeductionAmount?: number | null
  otherDeductions?: OtherDeductionItem[] | null
  deductionsSource?: 'MANUAL' | 'CALCULATED' | null
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

/** Stripped-down version of TaxCardInput — no Prisma types */
export interface TaxCalcInput {
  traekprocent: number
  personfradragMonthly: number
  pensionEmployeePct?: number | null
  pensionEmployerPct?: number | null
  atpAmount?: number | null
  bruttoItems?: BruttoItem[] | null
}

export interface TaxCalcResult {
  amBidrag: number
  aSkat: number
  topSkat: number
  atp: number
  pensionEmployee: number
  pensionEmployer: number
  bruttoTotal: number
  net: number
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

export function calcDanishDeductions(gross: number, settings: TaxCalcInput): TaxCalcResult {
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = _r2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))
  const taxableGross = gross - bruttoTotal

  const amBidrag = _r2(taxableGross * _AM_BIDRAG_RATE)
  const aIndkomst = taxableGross - amBidrag

  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = _r2(taxableBase * settings.traekprocent / 100)
  const topSkat = _r2(Math.max(0, aIndkomst - _TOP_SKAT_THRESHOLD) * _TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat

  const atp = _r2(settings.atpAmount ?? _DEFAULT_ATP)
  const pensionEmployee = settings.pensionEmployeePct
    ? _r2(gross * settings.pensionEmployeePct / 100)
    : 0
  const pensionEmployer = settings.pensionEmployerPct
    ? _r2(gross * settings.pensionEmployerPct / 100)
    : 0

  const net = _r2(gross - bruttoTotal - amBidrag - aSkat - atp - pensionEmployee)

  return { amBidrag, aSkat, topSkat, atp, pensionEmployee, pensionEmployer, bruttoTotal, net, isApproximate: true }
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