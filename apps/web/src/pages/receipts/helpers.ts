import axios from 'axios'
import type { Currency, ReceiptSummaryPeriod } from '../../api/types'
import { getApiError } from '../../lib/apiError'
import type {
  ConfirmReceiptBody, HeaderDraft, LineDraft, Receipt, ReceiptConfidence, ReceiptHeaderUpdate, ReceiptLineItem,
  ReceiptLineUpdate, ReceiptMappingImportStatus, ReceiptStatus,
} from './types'

export const EMPTY_MANUAL_LINE: LineDraft = {
  label: '',
  originalText: '',
  quantity: '',
  amount: '',
  categoryId: '',
  subcategoryId: '',
  confidence: 'HIGH',
  isIgnored: false,
}

export const CONFIDENCE_CLASS: Record<ReceiptConfidence, string> = {
  HIGH: 'bg-green-900/40 text-green-300 border-green-800',
  MEDIUM: 'bg-amber-900/30 text-amber-300 border-amber-800',
  LOW: 'bg-red-900/30 text-red-300 border-red-800',
}

export const MAPPING_STATUS_CLASS: Record<ReceiptMappingImportStatus, string> = {
  create: 'border-green-800 text-green-300 bg-green-900/30',
  update: 'border-blue-800 text-blue-300 bg-blue-900/30',
  unchanged: 'border-gray-700 text-gray-300 bg-gray-800/60',
  invalid: 'border-red-800 text-red-300 bg-red-900/30',
  skipped: 'border-amber-800 text-amber-300 bg-amber-900/30',
}

/** Border/text colour of a receipt status pill. */
export function receiptStatusClass(status: ReceiptStatus): string {
  return status === 'CONFIRMED' ? 'border-green-800 text-green-300' : 'border-amber-800 text-amber-300'
}

/** A denser variant of `inputClass` for the receipt review grids. */
export const compactInputClass =
  'w-full min-w-0 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors'

/** Small grey button used inside line-item rows. */
export const lineActionBtn = 'text-xs bg-gray-800 hover:bg-gray-700 rounded-md px-3 py-2 text-gray-300'

export const RECEIPT_PERIOD_OPTIONS: Array<{ value: ReceiptSummaryPeriod; label: string }> = [
  { value: 'allTime', label: 'All time' },
  { value: 'currentMonth', label: 'Current month' },
  { value: 'previousMonth', label: 'Previous month' },
  { value: 'currentQuarter', label: 'Current quarter' },
  { value: 'previousQuarter', label: 'Previous quarter' },
  { value: 'currentYear', label: 'Current year' },
  { value: 'previousYear', label: 'Previous year' },
  { value: 'last12Months', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom' },
]

export const CATEGORY_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#a78bfa']

// ── Drafts ────────────────────────────────────────────────────────────────────

export function lineToDraft(item: ReceiptLineItem): LineDraft {
  return {
    label: item.label,
    originalText: item.originalText,
    quantity: item.quantity ?? '',
    amount: item.amount,
    categoryId: item.categoryId ?? '',
    subcategoryId: item.subcategoryId ?? '',
    confidence: item.confidence,
    isIgnored: item.isIgnored,
  }
}

export function receiptToHeaderDraft(receipt: Receipt | undefined, baseCurrency: string): HeaderDraft {
  return {
    merchantName: receipt?.merchantName ?? '',
    purchaseDate: receipt?.purchaseDate ?? '',
    printedTotal: receipt?.printedTotal ?? '',
    taxAmount: receipt?.taxAmount ?? '',
    feeAmount: receipt?.feeAmount ?? '',
    currencyCode: receipt?.currencyCode ?? baseCurrency,
    accountId: receipt?.accountId ?? '',
  }
}

export function draftNeedsReview(draft: LineDraft): boolean {
  return draft.confidence === 'LOW' || !draft.categoryId
}

/** Body of PUT /households/:id/receipts/:receiptId. */
export function headerPayload(draft: HeaderDraft, baseCurrency: string): ReceiptHeaderUpdate {
  return {
    merchantName: draft.merchantName || null,
    purchaseDate: draft.purchaseDate || null,
    printedTotal: draft.printedTotal ? parseFloat(draft.printedTotal) : null,
    taxAmount: draft.taxAmount ? parseFloat(draft.taxAmount) : null,
    feeAmount: draft.feeAmount ? parseFloat(draft.feeAmount) : null,
    currencyCode: draft.currencyCode || baseCurrency || 'DKK',
    accountId: draft.accountId || null,
  }
}

/** Body of PUT …/line-items/:lineItemId. */
export function linePayload(draft: LineDraft): Required<ReceiptLineUpdate> {
  return {
    label: draft.label,
    originalText: draft.originalText,
    quantity: draft.quantity ? parseFloat(draft.quantity) : null,
    amount: parseFloat(draft.amount) || 0,
    categoryId: draft.categoryId || null,
    subcategoryId: draft.subcategoryId || null,
    confidence: draft.confidence,
    isIgnored: draft.isIgnored,
  }
}

/** Body of POST …/confirm: the header draft and every line's draft (unedited lines as loaded). */
export function confirmPayload(
  receipt: Receipt, headerDraft: HeaderDraft, lineDrafts: Record<string, LineDraft>, baseCurrency: string,
): ConfirmReceiptBody {
  return {
    receipt: headerPayload(headerDraft, baseCurrency),
    lineItems: receipt.lineItems.map((item) => ({ id: item.id, ...linePayload(lineDrafts[item.id] ?? lineToDraft(item)) })),
  }
}

/** Base currency first, then the enabled currencies, plus the receipt's own currency if it is no longer enabled. */
export function buildCurrencyOptions(baseCurrency: string, currencies: Currency[], currentCode: string) {
  const fallbackCurrency = baseCurrency || 'DKK'
  const options = new Map<string, { code: string; name: string }>()
  options.set(fallbackCurrency, { code: fallbackCurrency, name: 'Base currency' })
  for (const currency of currencies) {
    options.set(currency.code, { code: currency.code, name: currency.name })
  }
  if (currentCode && !options.has(currentCode)) {
    options.set(currentCode, { code: currentCode, name: 'Current receipt currency' })
  }
  return [...options.values()].sort((a, b) => {
    if (a.code === fallbackCurrency) return -1
    if (b.code === fallbackCurrency) return 1
    return a.code.localeCompare(b.code)
  })
}

// ── Consumption visualisation ─────────────────────────────────────────────────

export function parseMoney(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0')
  return Number.isFinite(parsed) ? parsed : 0
}

export function percentage(amount: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (amount / total) * 100))
}

export function formatPercent(value: number): string {
  return `${value < 10 && value > 0 ? value.toFixed(1) : value.toFixed(0)}%`
}

export function sameId(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null)
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/** Saves text as a file through a temporary download link. */
export function downloadText(fileName: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * `getApiError` plus two receipt cases: a friendly message for oversized uploads
 * (HTTP 413) and the message of a client-side validation Error thrown by a mutation.
 */
export function readError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 413) return 'Receipt file is too large. Upload a file smaller than 10 MB.'
    return getApiError(err, fallback)
  }
  if (err instanceof Error) return err.message
  return fallback
}
