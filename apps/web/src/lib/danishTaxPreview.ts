// Live preview of Danish payroll deductions for the salary / override forms.
// Frontend preview ONLY — the API recalculates and stores the real values
// (apps/api/src/lib/taxCalcDK.ts).

// ── Inline DK tax calculation (mirrors packages/shared/src/index.ts) ──────────

const TOP_SKAT_THRESHOLD = 49_075
const TOP_SKAT_RATE = 0.15
const AM_BIDRAG_RATE = 0.08
const DEFAULT_ATP = 99

export function r2(n: number) { return Math.round(n * 100) / 100 }

export interface LiveDeductions {
  amBidrag: number; aSkat: number; topSkat: number; atp: number
  pensionEmployee: number; pensionEmployer: number; bruttoTotal: number; bruttoItems: { label: string; monthlyAmount: number }[]; net: number
}

/**
 * Correct Danish payroll calculation order:
 *   1. Pre-AM: brutto items + pension employee + ATP → all reduce AM base
 *   2. AM-bidrag = 8% of AM-indkomst (truncated to whole DKK)
 *   3. A-skat = bottom tax + top-skat (both truncated to whole DKK)
 *   4. Net = gross − preAmTotal − amBidrag − aSkat
 */
export function calcDanishDeductions(
  gross: number,
  settings: { traekprocent: number; personfradragMonthly: number; pensionEmployeePct?: number | null; pensionEmployerPct?: number | null; atpAmount?: number | null; bruttoItems?: { label: string; monthlyAmount: number }[] | null }
): LiveDeductions {
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = r2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))
  const pensionEmployee = settings.pensionEmployeePct ? r2(gross * settings.pensionEmployeePct / 100) : 0
  const atp = Math.floor(settings.atpAmount ?? DEFAULT_ATP)
  const preAmTotal = r2(bruttoTotal + pensionEmployee + atp)
  const amBase = gross - preAmTotal
  const amBidrag = Math.floor(amBase * AM_BIDRAG_RATE)
  const aIndkomst = amBase - amBidrag
  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = Math.floor(taxableBase * settings.traekprocent / 100)
  const topSkat = Math.floor(Math.max(0, aIndkomst - TOP_SKAT_THRESHOLD) * TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat
  const pensionEmployer = settings.pensionEmployerPct ? r2(gross * settings.pensionEmployerPct / 100) : 0
  const net = r2(gross - preAmTotal - amBidrag - aSkat)
  return { amBidrag, aSkat, topSkat, atp, pensionEmployee, pensionEmployer, bruttoTotal, bruttoItems, net }
}
