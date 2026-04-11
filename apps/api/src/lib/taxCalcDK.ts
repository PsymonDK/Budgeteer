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

export type PayslipLineType = 'benefit_in_kind' | 'pre_am' | 'am_bidrag' | 'a_skat' | 'post_tax'
export type SankeyGroup = 'brutto_benefits' | 'am_bidrag' | 'a_skat' | 'pension_employee' | 'atp' | 'other_deductions'

export interface PayslipLine {
  label: string
  /** Positive — deduction or benefit amount */
  amount: number
  type: PayslipLineType
  /** Which Sankey node this line aggregates into */
  sankeyGroup?: SankeyGroup
  isCalculated: boolean
}

export interface DeductionResult {
  lines: PayslipLine[]
  pensionEmployer: number
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
 * Correct calculation order (matching real Danish payroll):
 *   1. Pre-AM deductions: bruttolønsordning items + pension employee % + ATP
 *      → all reduce AM-indkomst (the base for AM-bidrag)
 *   2. AM-bidrag = 8% of AM-indkomst, truncated to whole DKK
 *   3. A-skat = bottom tax (trækprocent after personfradrag) + top-skat (15% above threshold)
 *      → both truncated to whole DKK, matching real payroll systems
 *   4. Net = gross − preAmTotal − amBidrag − aSkat
 *
 * Pension employer contribution is returned separately — it is an employer cost
 * only and does not appear on the employee's net pay.
 */
export function calcDanishDeductions(gross: number, settings: TaxCardInput): DeductionResult {
  const lines: PayslipLine[] = []

  // ── Step 1: Pre-AM deductions (reduce AM base) ─────────────────────────────
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = round2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))

  for (const item of bruttoItems) {
    lines.push({
      label: item.label,
      amount: item.monthlyAmount,
      type: 'pre_am',
      sankeyGroup: 'brutto_benefits',
      isCalculated: true,
    })
  }

  const pensionEmployee = settings.pensionEmployeePct
    ? round2(gross * settings.pensionEmployeePct / 100)
    : 0
  if (pensionEmployee > 0) {
    lines.push({
      label: 'Pension (employee)',
      amount: pensionEmployee,
      type: 'pre_am',
      sankeyGroup: 'pension_employee',
      isCalculated: true,
    })
  }

  const atp = Math.floor(settings.atpAmount ?? DEFAULT_ATP)
  if (atp > 0) {
    lines.push({ label: 'ATP', amount: atp, type: 'pre_am', sankeyGroup: 'atp', isCalculated: true })
  }

  const preAmTotal = round2(bruttoTotal + pensionEmployee + atp)

  // ── Step 2: AM-bidrag — 8% of AM-indkomst, truncated ──────────────────────
  const amBase = gross - preAmTotal
  const amBidrag = Math.floor(amBase * AM_BIDRAG_RATE)
  lines.push({ label: 'AM-bidrag (8%)', amount: amBidrag, type: 'am_bidrag', sankeyGroup: 'am_bidrag', isCalculated: true })

  // ── Step 3: A-skat — truncated to whole DKK ───────────────────────────────
  const aIndkomst = amBase - amBidrag
  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = Math.floor(taxableBase * settings.traekprocent / 100)
  const topSkat = Math.floor(Math.max(0, aIndkomst - TOP_SKAT_MONTHLY_THRESHOLD) * TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat
  lines.push({
    label: topSkat > 0 ? `A-skat (incl. top-skat ${topSkat})` : 'A-skat',
    amount: aSkat,
    type: 'a_skat',
    sankeyGroup: 'a_skat',
    isCalculated: true,
  })

  // ── Pension employer (employer cost only, not deducted from net) ───────────
  const pensionEmployer = settings.pensionEmployerPct
    ? round2(gross * settings.pensionEmployerPct / 100)
    : 0

  const net = round2(gross - preAmTotal - amBidrag - aSkat)

  return { lines, pensionEmployer, net, isApproximate: true }
}
