import { BASE_CURRENCY } from './currency'
import {
  applyCategorySuggestions,
  isAllowedLocalAiHost,
  learnReceiptMappings,
  normalizeReceiptLabel,
} from './receiptClassifier'

export {
  applyCategorySuggestions,
  isAllowedLocalAiHost,
  learnReceiptMappings,
  merchantMappingKey,
  normalizeReceiptLabel,
  suggestCategory,
} from './receiptClassifier'

export type ReceiptConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ReceiptParseInput {
  rawText?: string
  fileBase64?: string
  mimeType?: 'application/pdf' | 'image/png' | 'image/jpeg'
  fileName?: string
}

export interface ParsedReceiptLineItem {
  originalText: string
  label: string
  normalizedLabel: string
  quantity?: number
  amount: number
  confidence: ReceiptConfidence
  categoryId?: string | null
  subcategoryId?: string | null
}

export interface ParsedReceipt {
  merchantName?: string | null
  purchaseDate?: string | null
  totalAmount?: number | null
  taxAmount?: number | null
  feeAmount?: number | null
  currencyCode: string
  confidence: ReceiptConfidence
  notes: string[]
  lineItems: ParsedReceiptLineItem[]
}

const LOW_VALUE_WORDS = new Set(['total', 'subtotal', 'sum', 'change', 'cash', 'card', 'visa', 'mastercard', 'dankort', 'tax', 'vat', 'moms'])

export async function parseReceipt(input: ReceiptParseInput, householdId: string): Promise<ParsedReceipt> {
  let localAi: ParsedReceipt | null = null
  let localAiNote: string | null = null
  try {
    localAi = await parseWithLocalAi(input)
  } catch (err) {
    localAiNote = err instanceof Error ? err.message : 'Local AI receipt enhancement failed.'
  }

  const parsed = localAi ?? parseReceiptText(input)
  if (localAiNote) {
    parsed.notes = [...parsed.notes, localAiNote]
  }
  return applyCategorySuggestions(parsed, householdId)
}

export function parseReceiptText(input: ReceiptParseInput): ParsedReceipt {
  const rawText = input.rawText?.trim() ?? ''
  if (!rawText) {
    return {
      merchantName: input.fileName ? input.fileName.replace(/\.[^.]+$/, '') : null,
      purchaseDate: null,
      totalAmount: null,
      taxAmount: null,
      feeAmount: null,
      currencyCode: BASE_CURRENCY,
      confidence: 'LOW',
      notes: ['No receipt text was available from server-side OCR or local AI. Review the stored receipt manually.'],
      lineItems: [],
    }
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const merchantName = inferMerchant(lines)
  const purchaseDate = inferDate(lines)
  const currencyCode = inferCurrency(rawText)
  const totalAmount = inferAmountByKeywords(lines, ['total', 'sum', 'amount due', 'beløb'])
  const taxAmount = inferAmountByKeywords(lines, ['tax', 'vat', 'moms'])
  const feeAmount = inferAmountByKeywords(lines, ['fee', 'gebyr'])
  const lineItems = inferLineItems(lines)

  return {
    merchantName,
    purchaseDate,
    totalAmount,
    taxAmount,
    feeAmount,
    currencyCode,
    confidence: lineItems.length > 0 ? 'MEDIUM' : 'LOW',
    notes: lineItems.length > 0 ? [] : ['No line items were detected. Review the OCR text manually before confirming.'],
    lineItems,
  }
}

async function parseWithLocalAi(input: ReceiptParseInput): Promise<ParsedReceipt | null> {
  const baseUrl = process.env.LOCAL_AI_BASE_URL
  const model = process.env.LOCAL_AI_MODEL
  if (!baseUrl || !model) return null

  const url = new URL(baseUrl)
  if (!isAllowedLocalAiHost(url.hostname)) {
    throw new Error('LOCAL_AI_BASE_URL must point to a local/self-hosted model endpoint')
  }

  const prompt = [
    'Extract this receipt into JSON only.',
    'Do not infer categories. Return merchantName, purchaseDate ISO date or null, totalAmount, taxAmount, feeAmount, currencyCode, confidence LOW/MEDIUM/HIGH, notes array, and lineItems.',
    'Each line item must include originalText, label, quantity or null, amount, and confidence LOW/MEDIUM/HIGH.',
    input.rawText ? `Receipt text:\n${input.rawText}` : `Receipt file: ${input.fileName ?? 'uploaded receipt'}`,
  ].join('\n\n')

  const payload: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    format: 'json',
  }

  if (input.fileBase64 && input.mimeType?.startsWith('image/')) {
    payload.images = [input.fileBase64]
  } else if (!input.rawText) {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(new URL('/api/generate', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Local AI parser failed with ${response.status}`)
    const data = await response.json() as { response?: string }
    if (!data.response) return null
    const parsed = JSON.parse(data.response) as Partial<ParsedReceipt>
    return normalizeParsedReceipt(parsed, input)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeParsedReceipt(parsed: Partial<ParsedReceipt>, input: ReceiptParseInput): ParsedReceipt {
  const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : []
  return {
    merchantName: typeof parsed.merchantName === 'string' ? parsed.merchantName : null,
    purchaseDate: typeof parsed.purchaseDate === 'string' ? parsed.purchaseDate : null,
    totalAmount: toNullableNumber(parsed.totalAmount),
    taxAmount: toNullableNumber(parsed.taxAmount),
    feeAmount: toNullableNumber(parsed.feeAmount),
    currencyCode: normalizeCurrency(parsed.currencyCode) ?? inferCurrency(input.rawText ?? '') ?? BASE_CURRENCY,
    confidence: normalizeConfidence(parsed.confidence),
    notes: Array.isArray(parsed.notes) ? parsed.notes.filter((n): n is string => typeof n === 'string') : [],
    lineItems: lineItems
      .map((item, index): ParsedReceiptLineItem | null => {
        const originalText = String(item.originalText ?? item.label ?? '').trim()
        const label = String(item.label ?? originalText).trim()
        const amount = toNullableNumber(item.amount)
        if (!label || amount == null) return null
        const parsedItem: ParsedReceiptLineItem = {
          originalText: originalText || label,
          label,
          normalizedLabel: normalizeReceiptLabel(label),
          amount,
          confidence: normalizeConfidence(item.confidence, index === 0 ? 'MEDIUM' : 'LOW'),
        }
        const quantity = toNullableNumber(item.quantity)
        if (quantity != null) parsedItem.quantity = quantity
        return parsedItem
      })
      .filter((item): item is ParsedReceiptLineItem => item != null),
  }
}

function inferMerchant(lines: string[]): string | null {
  return lines.find((line) => !extractTrailingAmount(line) && !/\d{2}[./-]\d{2}/.test(line))?.slice(0, 120) ?? null
}

function inferDate(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/)
    if (!match) continue
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
    }
  }
  return null
}

function inferCurrency(text: string): string {
  const explicit = text.match(/\b(DKK|EUR|USD|GBP|SEK|NOK)\b/i)?.[1]
  if (explicit) return explicit.toUpperCase()
  if (/[€]/.test(text)) return 'EUR'
  if (/[$]/.test(text)) return 'USD'
  if (/[£]/.test(text)) return 'GBP'
  return BASE_CURRENCY
}

function inferAmountByKeywords(lines: string[], keywords: string[]): number | null {
  for (const line of [...lines].reverse()) {
    const lower = line.toLowerCase()
    if (keywords.some((keyword) => lower.includes(keyword))) {
      const amount = extractTrailingAmount(line)
      if (amount != null) return amount
    }
  }
  return null
}

function inferLineItems(lines: string[]): ParsedReceiptLineItem[] {
  const items: ParsedReceiptLineItem[] = []
  for (const line of lines) {
    const amount = extractTrailingAmount(line)
    if (amount == null || amount <= 0) continue
    const label = line.replace(/[-+]?\d+[,.]\d{2}\s*$/, '').replace(/\s+(DKK|EUR|USD|GBP|SEK|NOK)\s*$/i, '').trim()
    const normalizedLabel = normalizeReceiptLabel(label)
    if (!label || !normalizedLabel) continue
    if ([...LOW_VALUE_WORDS].some((word) => normalizedLabel.includes(word))) continue
    items.push({
      originalText: line,
      label: label.slice(0, 200),
      normalizedLabel,
      amount,
      confidence: 'MEDIUM',
    })
  }
  return items
}

function extractTrailingAmount(line: string): number | null {
  const match = line.match(/(?:^|\s)([-+]?\d{1,6}(?:[.,]\d{2}))\s*(?:DKK|EUR|USD|GBP|SEK|NOK)?\s*$/i)
  if (!match) return null
  return Number(match[1].replace(',', '.'))
}

function normalizeConfidence(value: unknown, fallback: ReceiptConfidence = 'LOW'): ReceiptConfidence {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW' ? value : fallback
}

function normalizeCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/i.test(value) ? value.toUpperCase() : null
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : null
}
