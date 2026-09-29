// Shapes of the receipt API responses (apps/api/src/routes/receipts.ts) and the
// review screen's edit drafts. Decimals arrive as strings. Shapes shared with
// other screens (accounts, categories, consumption summary) live in api/types.ts.

import type { AccountInfo, Category } from '../../api/types'

export type ReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'FAILED'
export type ReceiptConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

/** GET /households/:id/receipt-subcategories */
export interface ReceiptSubcategory {
  id: string
  categoryId: string
  householdId: string | null
  name: string
  isSystemWide: boolean
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
  category: Pick<Category, 'id' | 'name' | 'icon'> | null
  subcategoryId: string | null
  subcategory: { id: string; name: string } | null
  isIgnored: boolean
}

/** GET /households/:id/receipts/:receiptId */
export interface Receipt {
  id: string
  merchantName: string | null
  purchaseDate: string | null
  /** Sum of the non-ignored line items, computed by the API. */
  totalAmount: string | null
  /** The TOTAL printed on the receipt (from OCR, user-correctable). */
  printedTotal: string | null
  /** True when the non-ignored line items don't add up to `printedTotal`. */
  totalMismatch: boolean
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
  printedTotal: string | null
  totalMismatch: boolean
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
  printedTotal: string
  taxAmount: string
  feeAmount: string
  currencyCode: string
  accountId: string
}

/** Body of PUT /households/:id/receipts/:receiptId (and `receipt` of the confirm body). */
export interface ReceiptHeaderUpdate {
  merchantName?: string | null
  /** YYYY-MM-DD */
  purchaseDate?: string | null
  printedTotal?: number | null
  taxAmount?: number | null
  feeAmount?: number | null
  currencyCode?: string
  accountId?: string | null
}

/** Body of PUT …/line-items/:lineItemId (and one entry of the confirm body's `lineItems`, plus `id`). */
export interface ReceiptLineUpdate {
  label?: string
  originalText?: string
  quantity?: number | null
  amount?: number
  categoryId?: string | null
  subcategoryId?: string | null
  confidence?: ReceiptConfidence
  isIgnored?: boolean
}

/**
 * Body of POST /households/:id/receipts/:receiptId/confirm: the API saves the
 * header and line edits and confirms in one transaction. 409
 * RECEIPT_ALREADY_CONFIRMED when the receipt is already confirmed.
 */
export interface ConfirmReceiptBody {
  receipt?: ReceiptHeaderUpdate
  lineItems?: Array<ReceiptLineUpdate & { id: string }>
}
