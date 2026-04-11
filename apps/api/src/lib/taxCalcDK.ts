/**
 * Danish payroll tax calculation engine.
 *
 * Hardcoded 2024 tax constants — update annually:
 *   - Top-skat threshold:  588,900 DKK/year  → 49,075 DKK/month
 *   - Top-skat rate:       15%
 *   - AM-bidrag rate:      8%
 *   - Default ATP:         99 DKK/month (full-time 2024 rate)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BruttoItem {
  label: string
  monthlyAmount: number
}

export interface TaxCardInput {
  traekprocent: number          // municipal + state bottom tax rate, e.g. 38
  personfradragMonthly: number  // personal deduction, e.g. 3875
  pensionEmployeePct?: number | null
  pensionEmployerPct?: number | null
  atpAmount?: number | null
  bruttoItems?: BruttoItem[] | null
}

export interface DeductionBreakdown {
  amBidrag: number
  aSkat: number
  /** Top-skat component already included inside aSkat */
  topSkat: number
  atp: number
  pensionEmployee: number
  pensionEmployer: number
  bruttoTotal: number
  bruttoItems: BruttoItem[]
  net: number
  /** Always true — calculation uses trækprocent directly, not marginal rate tables */
  isApproximate: true
}

// ── Constants (2024) ──────────────────────────────────────────────────────────

/** 588,900 DKK/year ÷ 12 */
const TOP_SKAT_MONTHLY_THRESHOLD = 49_075
const TOP_SKAT_RATE = 0.15
const AM_BIDRAG_RATE = 0.08
const DEFAULT_ATP = 99 // DKK/month, full-time 2024

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Calculate Danish payroll deductions for a given gross monthly salary.
 *
 * Calculation order:
 *   1. Bruttolønsordning reduces taxable base (tax-advantaged)
 *   2. AM-bidrag (8% of taxable gross)
 *   3. A-skat = bottom tax (trækprocent after personfradrag) + top-skat (15% above threshold)
 *   4. ATP and pension calculated on full gross (not taxable gross)
 */
export function calcDanishDeductions(gross: number, settings: TaxCardInput): DeductionBreakdown {
  // Step 1: Bruttolønsordning — reduce taxable base
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = round2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))
  const taxableGross = gross - bruttoTotal

  // Step 2: AM-bidrag — always 8% of taxable gross
  const amBidrag = round2(taxableGross * AM_BIDRAG_RATE)
  const aIndkomst = taxableGross - amBidrag

  // Step 3: A-skat — bottom tax + top-skat
  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = round2(taxableBase * settings.traekprocent / 100)
  const topSkat = round2(Math.max(0, aIndkomst - TOP_SKAT_MONTHLY_THRESHOLD) * TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat

  // Step 4: ATP and pension — calculated on full gross
  const atp = round2(settings.atpAmount ?? DEFAULT_ATP)
  const pensionEmployee = settings.pensionEmployeePct
    ? round2(gross * settings.pensionEmployeePct / 100)
    : 0
  const pensionEmployer = settings.pensionEmployerPct
    ? round2(gross * settings.pensionEmployerPct / 100)
    : 0

  const net = round2(gross - bruttoTotal - amBidrag - aSkat - atp - pensionEmployee)

  return {
    amBidrag,
    aSkat,
    topSkat,
    atp,
    pensionEmployee,
    pensionEmployer,
    bruttoTotal,
    bruttoItems,
    net,
    isApproximate: true,
  }
}
