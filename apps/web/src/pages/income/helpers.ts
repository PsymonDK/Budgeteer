import { toLocalISODate } from '../../lib/dates'
import { r2, type LiveDeductions } from '../../lib/danishTaxPreview'
import type {
  BonusForm, DeductionOverrides, JobForm, OverrideForm, SalaryForm, TaxCardForm,
} from './types'

export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function toDateInput(iso: string) {
  return iso.slice(0, 10)
}

// ── Empty forms ───────────────────────────────────────────────────────────────

export const emptyJob = (): JobForm => ({ name: '', employer: '', country: 'DK', startDate: toLocalISODate(), endDate: '' })
export const emptySalary = (baseCurrency: string): SalaryForm => ({ grossAmount: '', netAmount: '', effectiveFrom: toLocalISODate(), currencyCode: baseCurrency })
export const emptyOverride: OverrideForm = { year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1), grossAmount: '', netAmount: '', note: '' }
export const emptyBonus = (baseCurrency: string): BonusForm => ({ label: '', grossAmount: '', netAmount: '', paymentDate: toLocalISODate(), includeInBudget: true, budgetMode: 'ONE_OFF', currencyCode: baseCurrency })
export const emptyTaxCard = (): TaxCardForm => ({ effectiveFrom: toLocalISODate(), traekprocent: '', personfradragMonthly: '3875', municipality: '', pensionEmployeePct: '', pensionEmployerPct: '', atpAmount: '', bruttoItems: [] })
export const emptyDeductionOverrides = (): DeductionOverrides => ({ amBidragAmount: '', aSkattAmount: '', pensionEmployeeAmount: '', atpAmount: '' })

// ── Request payload builders ──────────────────────────────────────────────────

export function buildTaxCardPayload(data: TaxCardForm) {
  return {
    effectiveFrom: data.effectiveFrom,
    traekprocent: parseFloat(data.traekprocent),
    personfradragMonthly: parseFloat(data.personfradragMonthly),
    municipality: data.municipality || undefined,
    pensionEmployeePct: data.pensionEmployeePct ? parseFloat(data.pensionEmployeePct) : undefined,
    pensionEmployerPct: data.pensionEmployerPct ? parseFloat(data.pensionEmployerPct) : undefined,
    atpAmount: data.atpAmount ? parseFloat(data.atpAmount) : undefined,
    bruttoItems: data.bruttoItems.filter((i) => i.label && i.monthlyAmount).map((i) => ({ label: i.label, monthlyAmount: parseFloat(i.monthlyAmount) })),
  }
}

// An override field left blank uses the calculated amount; an explicit 0 is a real value.
function overrideOr(value: string, calculated: number): number {
  if (value.trim() === '') return calculated
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : calculated
}

export function computeManualNet(gross: number, calc: LiveDeductions, overrides: DeductionOverrides): number {
  const pension = overrideOr(overrides.pensionEmployeeAmount, calc.pensionEmployee)
  const atp = overrideOr(overrides.atpAmount, calc.atp)
  const amBidrag = overrideOr(overrides.amBidragAmount, calc.amBidrag)
  const aSkat = overrideOr(overrides.aSkattAmount, calc.aSkat)
  return r2(gross - calc.bruttoTotal - pension - atp - amBidrag - aSkat)
}

export function buildPayslipLines(calc: LiveDeductions, overrides: DeductionOverrides) {
  type LineType = 'benefit_in_kind' | 'pre_am' | 'am_bidrag' | 'a_skat' | 'post_tax'
  const lines: { label: string; amount: number; type: LineType; sankeyGroup?: string; isCalculated: boolean }[] = []
  for (const item of calc.bruttoItems) {
    lines.push({ label: item.label, amount: item.monthlyAmount, type: 'pre_am', sankeyGroup: 'brutto_benefits', isCalculated: true })
  }
  const pension = overrideOr(overrides.pensionEmployeeAmount, calc.pensionEmployee)
  if (pension > 0) {
    lines.push({ label: 'Pension (employee)', amount: pension, type: 'pre_am', sankeyGroup: 'pension_employee', isCalculated: !overrides.pensionEmployeeAmount.trim() })
  }
  lines.push({ label: 'ATP', amount: overrideOr(overrides.atpAmount, calc.atp), type: 'pre_am', sankeyGroup: 'atp', isCalculated: !overrides.atpAmount.trim() })
  lines.push({ label: 'AM-bidrag (8%)', amount: overrideOr(overrides.amBidragAmount, calc.amBidrag), type: 'am_bidrag', sankeyGroup: 'am_bidrag', isCalculated: !overrides.amBidragAmount.trim() })
  lines.push({ label: 'A-skat', amount: overrideOr(overrides.aSkattAmount, calc.aSkat), type: 'a_skat', sankeyGroup: 'a_skat', isCalculated: !overrides.aSkattAmount.trim() })
  return lines
}

/**
 * Salary / override request fields derived from the DK deduction preview:
 * the net to submit and, when a deduction was edited by hand, the payslip lines.
 */
export function deductionSubmission(grossAmount: string, netAmount: string, deductionOverrides: DeductionOverrides, liveCalc: LiveDeductions | null) {
  const hasManualOverride = Object.values(deductionOverrides).some((v) => v !== '')
  const deductionPayload = (liveCalc && hasManualOverride) ? {
    payslipLines: buildPayslipLines(liveCalc, deductionOverrides),
  } : {}
  const net = liveCalc
    ? (hasManualOverride ? computeManualNet(parseFloat(grossAmount), liveCalc, deductionOverrides) : liveCalc.net)
    : parseFloat(netAmount)
  return { net, deductionPayload }
}

/** Preview input for calcDanishDeductions from a job's active tax card. */
export function taxCardPreviewSettings(card: {
  traekprocent: string; personfradragMonthly: string; pensionEmployeePct: string | null
  pensionEmployerPct: string | null; atpAmount: string | null; bruttoItems: { label: string; monthlyAmount: number }[] | null
}) {
  return {
    traekprocent: parseFloat(card.traekprocent),
    personfradragMonthly: parseFloat(card.personfradragMonthly),
    pensionEmployeePct: card.pensionEmployeePct ? parseFloat(card.pensionEmployeePct) : null,
    pensionEmployerPct: card.pensionEmployerPct ? parseFloat(card.pensionEmployerPct) : null,
    atpAmount: card.atpAmount ? parseFloat(card.atpAmount) : null,
    bruttoItems: card.bruttoItems,
  }
}
