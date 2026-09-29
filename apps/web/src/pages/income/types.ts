// Types for the personal income screen (jobs, salary history, overrides, bonuses, tax cards).

export type BudgetMode = 'ONE_OFF' | 'SPREAD_ANNUALLY'

export interface SalaryRecord {
  id: string
  jobId: string
  grossAmount: string
  netAmount: string
  effectiveFrom: string
  currencyCode: string | null
  rateUsed: string | null
  amBidragAmount: string | null
  aSkattAmount: string | null
  pensionEmployeeAmount: string | null
  pensionEmployerAmount: string | null
  atpAmount: string | null
  bruttoDeductionAmount: string | null
  deductionsSource: string | null
  createdAt: string
}

export interface MonthlyOverride {
  id: string
  jobId: string
  year: number
  month: number
  grossAmount: string
  netAmount: string
  note: string | null
  amBidragAmount: string | null
  aSkattAmount: string | null
  pensionEmployeeAmount: string | null
  pensionEmployerAmount: string | null
  atpAmount: string | null
  bruttoDeductionAmount: string | null
  deductionsSource: string | null
  createdAt: string
}

export interface TaxCardSettings {
  id: string
  jobId: string
  effectiveFrom: string
  traekprocent: string
  personfradragMonthly: string
  municipality: string | null
  pensionEmployeePct: string | null
  pensionEmployerPct: string | null
  atpAmount: string | null
  bruttoItems: { label: string; monthlyAmount: number }[] | null
  createdAt: string
}

export interface Bonus {
  id: string
  jobId: string
  label: string
  grossAmount: string
  netAmount: string
  paymentDate: string
  includeInBudget: boolean
  budgetMode: BudgetMode | null
  currencyCode: string | null
  rateUsed: string | null
  createdAt: string
}

export interface JobAllocation {
  budgetYearId: string
  allocationPct: string
  /** The household's default (active, else earliest future) year — the one allocation edits target */
  isDefaultYear: boolean
  budgetYear: {
    id: string
    year: number
    status: string
    household: { id: string; name: string }
  }
}

export interface Job {
  id: string
  name: string
  employer: string | null
  country: string
  startDate: string
  endDate: string | null
  isActive: boolean
  latestSalary: SalaryRecord | null
  upcomingBonusCount: number
  allocations: JobAllocation[]
}

export interface HistoryBucket {
  period: string
  gross: number
  net: number
  total: number
  perJob: { jobId: string; jobName: string; gross: number; net: number }[]
  bonuses: { jobId: string; label: string; gross: number; net: number }[]
}

export type Tab = 'jobs' | 'overrides' | 'bonuses' | 'trash'
export type Granularity = 'monthly' | 'quarterly' | 'yearly'

// ── Forms ─────────────────────────────────────────────────────────────────────

export interface JobForm { name: string; employer: string; country: string; startDate: string; endDate: string }
export interface SalaryForm { grossAmount: string; netAmount: string; effectiveFrom: string; currencyCode: string }
export interface OverrideForm { year: string; month: string; grossAmount: string; netAmount: string; note: string }
export interface BonusForm { label: string; grossAmount: string; netAmount: string; paymentDate: string; includeInBudget: boolean; budgetMode: BudgetMode | ''; currencyCode: string }

export interface TaxCardForm {
  effectiveFrom: string
  traekprocent: string
  personfradragMonthly: string
  municipality: string
  pensionEmployeePct: string
  pensionEmployerPct: string
  atpAmount: string
  bruttoItems: { label: string; monthlyAmount: string }[]
}

export interface DeductionOverrides {
  amBidragAmount: string
  aSkattAmount: string
  pensionEmployeeAmount: string
  atpAmount: string
}

export interface TaxCardDraft {
  effectiveFrom: string
  traekprocent: number
  personfradragMonthly: number
  pensionEmployeePct?: number
  pensionEmployerPct?: number
  atpAmount?: number
}
