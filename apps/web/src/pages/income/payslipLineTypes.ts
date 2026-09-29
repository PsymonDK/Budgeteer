import type { PayslipLineType } from '../../lib/parsePayslipCsv'

export const LINE_TYPE_LABELS: Record<PayslipLineType, string> = {
  benefit_in_kind: 'Benefit in kind (brutto)',
  pre_am: 'Pre-tax deduction (AM base)',
  am_bidrag: 'AM-bidrag (8%)',
  a_skat: 'A-skat',
  post_tax: 'Post-tax deduction',
}

export const LINE_TYPE_SANKEY: Record<PayslipLineType, string> = {
  benefit_in_kind: 'brutto_benefits',
  pre_am: 'other_deductions',
  am_bidrag: 'am_bidrag',
  a_skat: 'a_skat',
  post_tax: 'other_deductions',
}
