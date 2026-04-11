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