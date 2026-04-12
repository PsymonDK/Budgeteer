// ── Local type definitions (mirrors packages/shared/src/index.ts) ─────────────

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

const VALID_LINE_TYPES: PayslipLineType[] = ['benefit_in_kind', 'pre_am', 'am_bidrag', 'a_skat', 'post_tax']

const SANKEY_GROUP_MAP: Record<PayslipLineType, SankeyGroup> = {
  benefit_in_kind: 'brutto_benefits',
  pre_am: 'other_deductions',
  am_bidrag: 'am_bidrag',
  a_skat: 'a_skat',
  post_tax: 'other_deductions',
}

function detectSankeyGroup(type: PayslipLineType, label: string): SankeyGroup {
  const l = label.toLowerCase()
  if (type === 'pre_am') {
    if (l.includes('pension') && (l.includes('employee') || l.includes('medarbejder') || l.includes('eget'))) return 'pension_employee'
    if (l.includes('atp')) return 'atp'
    if (l.includes('brutto') || l.includes('benefit') || l.includes('telefon') || l.includes('phone')) return 'brutto_benefits'
  }
  if (type === 'benefit_in_kind') return 'brutto_benefits'
  return SANKEY_GROUP_MAP[type]
}

/**
 * Parse a payslip CSV template into a PayslipExtraction.
 *
 * CSV format:
 *   row_type,key_or_type,label,value_or_amount
 *
 * Meta rows (row_type = "meta"):
 *   meta,year,,2023
 *   meta,month,,10
 *   meta,employer,,Cepheo A/S
 *   meta,currency,,DKK
 *   meta,gross,,66310.69
 *   meta,net,,38536.86
 *   meta,pension_employer,,7848.14
 *
 * Line rows (row_type = "line"):
 *   line,pre_am,Pension (employee),1945.82
 *   line,am_bidrag,"AM-bidrag (8%)",5234.00
 *
 * Lines starting with # are ignored.
 */
export function parsePayslipCsv(csvText: string): PayslipExtraction {
  const rawLines = csvText.split(/\r?\n/)
  const meta: Record<string, string> = {}
  const lines: PayslipLine[] = []

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const cols = splitCsvRow(trimmed)
    if (cols.length < 2) continue

    const rowType = cols[0].trim().toLowerCase()

    if (rowType === 'row_type') continue // header row

    if (rowType === 'meta') {
      const key = cols[1].trim().toLowerCase()
      const value = (cols[3] ?? cols[2] ?? '').trim()
      meta[key] = value
    } else if (rowType === 'line') {
      const typeRaw = cols[1].trim().toLowerCase() as PayslipLineType
      if (!VALID_LINE_TYPES.includes(typeRaw)) {
        throw new Error(
          `Unknown line type "${cols[1].trim()}" on row: ${rawLine}\nValid types: ${VALID_LINE_TYPES.join(', ')}`,
        )
      }
      const label = cols[2]?.trim() ?? ''
      const amountRaw = cols[3]?.trim() ?? ''
      const amount = parseFloat(amountRaw.replace(',', '.'))
      if (isNaN(amount)) {
        throw new Error(`Invalid amount "${amountRaw}" for line "${label}"`)
      }
      lines.push({
        label,
        amount,
        type: typeRaw,
        sankeyGroup: detectSankeyGroup(typeRaw, label),
        isCalculated: false,
      })
    }
    // unknown row_type values are silently skipped
  }

  // Validate required meta fields
  const year = parseInt(meta['year'] ?? '')
  const month = parseInt(meta['month'] ?? '')
  if (isNaN(year) || year < 2000 || year > 2100) throw new Error('Missing or invalid "year" in meta section')
  if (isNaN(month) || month < 1 || month > 12) throw new Error('Missing or invalid "month" in meta section (1–12)')

  const gross = parseFloat((meta['gross'] ?? '').replace(',', '.'))
  const net = parseFloat((meta['net'] ?? '').replace(',', '.'))
  if (isNaN(gross) || gross <= 0) throw new Error('Missing or invalid "gross" in meta section')
  if (isNaN(net) || net <= 0) throw new Error('Missing or invalid "net" in meta section')

  const pensionEmployer = parseFloat((meta['pension_employer'] ?? '').replace(',', '.'))

  return {
    period: { year, month },
    employerName: meta['employer'] ?? '',
    grossSalary: gross,
    netPay: net,
    currency: meta['currency'] || 'DKK',
    lines,
    pensionEmployerMonthly: isNaN(pensionEmployer) ? undefined : pensionEmployer,
    confidence: 'high',
  }
}

/** Split a single CSV row respecting double-quoted fields. */
function splitCsvRow(row: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
