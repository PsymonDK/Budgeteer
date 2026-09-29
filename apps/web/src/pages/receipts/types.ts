// Shapes of the receipt API responses (apps/api/src/routes/receipts.ts) and the
// review screen's edit drafts. Decimals arrive as strings.

export type ReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'FAILED'
export type ReceiptConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Category {
  id: string
  name: string
  icon: string | null
}

/** GET /households/:id/receipt-subcategories */
export interface ReceiptSubcategory {
  id: string
  categoryId: string
  householdId: string | null
  name: string
  isSystemWide: boolean
}

export interface AccountInfo {
  id: string
  name: string
  type: string
}

export interface Currency {
  code: string
  name: string
  rate: number | null
  baseCurrency: string
  fetchedDate: string | null
}

export interface ReceiptLineItem {
  id: string
  originalText: string
  label: string
  normalizedLabel: string
  quantity: string | null
  amount: string
  currencyCode: string | null
  confidence: ReceiptConfidence
  categoryId: string | null
  category: Category | null
  subcategoryId: string | null
  subcategory: ReceiptSubcategory | null
  isIgnored: boolean
}

/** GET /households/:id/receipts/:receiptId */
export interface Receipt {
  id: string
  merchantName: string | null
  purchaseDate: string | null
  totalAmount: string | null
  taxAmount: string | null
  feeAmount: string | null
  currencyCode: string
  status: ReceiptStatus
  confidence: ReceiptConfidence
  sourceFileName: string | null
  sourceMimeType: string | null
  rawText: string | null
  hasSourceFile: boolean
  notes: string[]
  accountId: string | null
  account: AccountInfo | null
  lineItems: ReceiptLineItem[]
  createdAt: string
}

/** GET /households/:id/receipts (one row per receipt) */
export interface ReceiptSummary {
  id: string
  merchantName: string | null
  purchaseDate: string | null
  totalAmount: string | null
  currencyCode: string
  status: ReceiptStatus
  confidence: ReceiptConfidence
  itemCount: number
  itemTotal: string
  lowConfidenceCount: number
}

/** GET /households/:id/receipt-mappings/export-kit */
export interface ReceiptMappingExportKit {
  headers: string[]
  prompt: string
  templateCsv: string
  categoryCsv: string
  existingMappingsCsv: string
  classifierTermCsv: string
}

export type ReceiptMappingImportStatus = 'create' | 'update' | 'unchanged' | 'invalid' | 'skipped'

export interface ReceiptMappingImportRow {
  rowNumber: number
  merchantName: string
  merchantKey: string
  originalLabel: string
  normalizedLabel: string
  categoryId: string
  categoryName: string
  subcategoryId: string | null
  subcategoryName: string
  confidence: number
  termType: '' | 'NOISE_TOKEN' | 'LOW_VALUE_WORD'
  term: string
  isActive: boolean
  kind: 'mapping' | 'term'
  notes: string
  status: ReceiptMappingImportStatus
  errors: string[]
}

/** POST /households/:id/receipt-mappings/import-preview and import-confirm */
export interface ReceiptMappingImportPreview {
  counts: Record<ReceiptMappingImportStatus, number> & { total: number; valid: number }
  rows: ReceiptMappingImportRow[]
}

export type ReceiptSummaryPeriod = 'allTime' | 'currentMonth' | 'previousMonth' | 'currentQuarter' | 'previousQuarter' | 'currentYear' | 'previousYear' | 'last12Months' | 'custom'

/** GET /households/:id/receipts/summary */
export interface ReceiptConsumptionSummary {
  total: string
  itemCount: number
  baseCurrency: string
  period: ReceiptSummaryPeriod | 'legacy'
  startDate: string | null
  endDate: string | null
  warnings: string[]
  byCategory: Array<{ categoryId: string | null; categoryName: string; categoryIcon: string | null; total: string; itemCount: number }>
  bySubcategory: Array<{ categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: string; itemCount: number }>
  byMonth: Array<{ month: string; total: string }>
}

/** Edit state of one line item (inputs keep their raw strings). */
export interface LineDraft {
  label: string
  originalText: string
  quantity: string
  amount: string
  categoryId: string
  subcategoryId: string
  confidence: ReceiptConfidence
  isIgnored: boolean
}

/** Edit state of the receipt header form. */
export interface HeaderDraft {
  merchantName: string
  purchaseDate: string
  totalAmount: string
  taxAmount: string
  feeAmount: string
  currencyCode: string
  accountId: string
}
