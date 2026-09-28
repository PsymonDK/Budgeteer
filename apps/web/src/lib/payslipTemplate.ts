// CSV template offered for download in the payslip import dialog; parsed by lib/parsePayslipCsv.ts.

export const PAYSLIP_CSV_TEMPLATE = `# Payslip Import Template for Budgeteer
# Fill in the values below and upload this file via the Import Payslip dialog.
# Lines starting with # are comments and will be ignored.
#
# METADATA ROWS (row_type = meta):
#   meta,year,,YYYY               (required)
#   meta,month,,M                 (required, 1-12)
#   meta,employer,,Company Name   (optional)
#   meta,currency,,DKK            (optional, default: DKK)
#   meta,gross,,AMOUNT            (required, total monthly salary excl. reimbursements)
#   meta,net,,AMOUNT              (required, amount transferred to bank account)
#   meta,pension_employer,,AMOUNT (optional, employer pension DKK/month — used to derive pension employer %)
#
# DEDUCTION LINE ROWS (row_type = line):
#   Valid types:
#   benefit_in_kind  Taxable benefit value added to gross (Fri telefon, phone/device value)
#   pre_am           Deductions that reduce AM base: pension employee (DKK amount), ATP, health insurance brutto
#   am_bidrag        AM-bidrag (8% of AM-indkomst)
#   a_skat           A-skat (income tax)
#   post_tax         After-tax deductions: canteen, union fees, health insurance netto
#
row_type,key_or_type,label,value_or_amount
meta,year,,2025
meta,month,,1
meta,employer,,Your Employer A/S
meta,currency,,DKK
meta,gross,,50000.00
meta,net,,30000.00
meta,pension_employer,,0.00
line,pre_am,Pension (employee),1500.00
line,pre_am,ATP,99.00
line,am_bidrag,"AM-bidrag (8%)",3880.00
line,a_skat,A-skat,14521.00
`
