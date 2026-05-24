import { BASE_CURRENCY } from './currency'
import {
  applyCategorySuggestions,
  correctReceiptOcrText,
  fallbackReceiptClassifierConfig,
  isAllowedLocalAiHost,
  learnReceiptMappings,
  loadReceiptClassifierConfig,
  normalizeReceiptLabel,
  type ReceiptClassifierConfig,
} from './receiptClassifier'

export {
  applyCategorySuggestions,
  correctReceiptOcrText,
  fallbackReceiptClassifierConfig,
  isAllowedLocalAiHost,
  learnReceiptMappings,
  loadReceiptClassifierConfig,
  merchantMappingKey,
  normalizeReceiptLabel,
  suggestCategory,
} from './receiptClassifier'

export type ReceiptConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ReceiptParseInput {
  rawText?: string
  displayRawText?: string
  fileBase64?: string
  mimeType?: 'application/pdf' | 'image/png' | 'image/jpeg'
  fileName?: string
  fallbackCurrency?: string
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

export async function parseReceipt(input: ReceiptParseInput, householdId: string): Promise<ParsedReceipt> {
  const classifierConfig = await loadReceiptClassifierConfig(householdId)
  let localAi: ParsedReceipt | null = null
  let localAiNote: string | null = null
  try {
    localAi = await parseWithLocalAi(input, classifierConfig)
  } catch (err) {
    localAiNote = err instanceof Error ? err.message : 'Local AI receipt enhancement failed.'
  }

  const parsed = localAi ?? parseReceiptText(input, classifierConfig)
  if (localAiNote) {
    parsed.notes = [...parsed.notes, localAiNote]
  }
  return applyCategorySuggestions(parsed, householdId)
}

export function parseReceiptText(input: ReceiptParseInput, classifierConfig?: ReceiptClassifierConfig): ParsedReceipt {
  const effectiveClassifierConfig = classifierConfig ?? fallbackReceiptClassifierConfig()
  const rawText = input.rawText?.trim() ?? ''
  const fallbackCurrency = normalizeCurrency(input.fallbackCurrency) ?? BASE_CURRENCY
  if (!rawText) {
    return {
      merchantName: input.fileName ? input.fileName.replace(/\.[^.]+$/, '') : null,
      purchaseDate: null,
      totalAmount: null,
      taxAmount: null,
      feeAmount: null,
      currencyCode: fallbackCurrency,
      confidence: 'LOW',
      notes: ['No receipt text was available from server-side OCR or local AI. Review the stored receipt manually.'],
      lineItems: [],
    }
  }

  const lines = splitReceiptLines(rawText)
  const displayLines = input.displayRawText?.trim()
    ? splitReceiptLines(input.displayRawText)
    : lines

  const merchantName = inferMerchant(lines)
  const purchaseDate = inferDate(lines)
  const currencyCode = inferCurrency(rawText) ?? fallbackCurrency
  const totalAmount = inferAmountByKeywords(lines, ['total', 'sum', 'amount due', 'beløb', 'belob', 'at betale', 'til betaling', 'i alt', 'ialt'])
  const taxAmount = inferAmountByKeywords(lines, ['tax', 'vat', 'moms'])
  const feeAmount = inferAmountByKeywords(lines, ['fee', 'gebyr'])
  const lineItems = inferLineItems(lines, effectiveClassifierConfig, displayLines)

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

async function parseWithLocalAi(input: ReceiptParseInput, classifierConfig: ReceiptClassifierConfig): Promise<ParsedReceipt | null> {
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
    return normalizeParsedReceipt(parsed, input, classifierConfig)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeParsedReceipt(parsed: Partial<ParsedReceipt>, input: ReceiptParseInput, classifierConfig?: ReceiptClassifierConfig): ParsedReceipt {
  const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : []
  const fallbackCurrency = normalizeCurrency(input.fallbackCurrency) ?? BASE_CURRENCY
  return {
    merchantName: typeof parsed.merchantName === 'string' ? parsed.merchantName : null,
    purchaseDate: typeof parsed.purchaseDate === 'string' ? parsed.purchaseDate : null,
    totalAmount: toNullableNumber(parsed.totalAmount),
    taxAmount: toNullableNumber(parsed.taxAmount),
    feeAmount: toNullableNumber(parsed.feeAmount),
    currencyCode: normalizeCurrency(parsed.currencyCode) ?? inferCurrency(input.rawText ?? '') ?? fallbackCurrency,
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
          normalizedLabel: normalizeReceiptLabel(label, classifierConfig),
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

function inferCurrency(text: string): string | null {
  const explicit = text.match(/\b(DKK|EUR|USD|GBP|SEK|NOK)\b/i)?.[1]
  if (explicit) return explicit.toUpperCase()
  if (/[€]/.test(text)) return 'EUR'
  if (/[$]/.test(text)) return 'USD'
  if (/[£]/.test(text)) return 'GBP'
  if (/\b(?:kr\.?|kroner)\b/i.test(text) && /\b(?:moms|dankort|beløb|gebyr|kvittering|butik)\b/i.test(text)) return 'DKK'
  return null
}

function inferAmountByKeywords(lines: string[], keywords: string[]): number | null {
  for (const line of [...lines].reverse()) {
    const lower = line.toLowerCase()
    if (keywords.some((keyword) => lower.includes(keyword))) {
      const amount = extractLastAmount(line)
      if (amount != null) return amount
    }
  }
  return null
}

function inferLineItems(lines: string[], classifierConfig?: ReceiptClassifierConfig, displayLines: string[] = lines): ParsedReceiptLineItem[] {
  const items: ParsedReceiptLineItem[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const direct = buildDirectLineItem(lines, displayLines, index, classifierConfig)
    if (direct) {
      items.push(direct.item)
      index = direct.endIndex
      continue
    }

    const multiLine = buildMultiLineItem(lines, displayLines, index, classifierConfig)
    if (multiLine) {
      items.push(multiLine.item)
      index = multiLine.endIndex
    }
  }
  return items
}

function buildDirectLineItem(
  lines: string[],
  displayLines: string[],
  index: number,
  classifierConfig?: ReceiptClassifierConfig,
): { item: ParsedReceiptLineItem; endIndex: number } | null {
  const line = lines[index]
  const displayLine = displayLines[index] ?? line
  const amount = extractTrailingAmount(line) ?? extractTrailingAmount(displayLine)
  if (amount == null || amount <= 0) return null

  const parseLabel = stripTrailingAmountAndCurrency(line)
  const displayLabel = stripTrailingAmountAndCurrency(displayLine) || parseLabel
  const normalizedLabel = normalizeReceiptLabel(parseLabel || displayLabel, classifierConfig)
  if (shouldSkipLineItem(line, displayLine, displayLabel, normalizedLabel, classifierConfig)) return null

  const discountAdjustment = findDiscountAdjustment(lines, displayLines, index, amount)
  const originalText = joinOriginalLines(displayLines, index, discountAdjustment?.endIndex ?? index)
  const item: ParsedReceiptLineItem = {
    originalText,
    label: displayLabel.slice(0, 200),
    normalizedLabel,
    amount: discountAdjustment?.amount ?? amount,
    confidence: 'MEDIUM',
  }
  const quantity = inferLineQuantity(parseLabel)
  if (quantity != null) item.quantity = quantity
  return { item, endIndex: discountAdjustment?.endIndex ?? index }
}

function buildMultiLineItem(
  lines: string[],
  displayLines: string[],
  index: number,
  classifierConfig?: ReceiptClassifierConfig,
): { item: ParsedReceiptLineItem; endIndex: number } | null {
  const line = lines[index]
  const displayLine = displayLines[index] ?? line
  const label = displayLine.trim()
  const normalizedLabel = normalizeReceiptLabel(line || label, classifierConfig)
  if (shouldSkipProductLabelCandidate(line, displayLine, normalizedLabel, classifierConfig)) return null

  const continuation = findPriceContinuation(lines, displayLines, index, classifierConfig)
  if (!continuation) return null

  const item: ParsedReceiptLineItem = {
    originalText: joinOriginalLines(displayLines, index, continuation.endIndex),
    label: label.slice(0, 200),
    normalizedLabel,
    amount: continuation.amount,
    confidence: 'MEDIUM',
  }
  const quantity = inferLineQuantity(line)
  if (quantity != null) item.quantity = quantity
  return { item, endIndex: continuation.endIndex }
}

function findPriceContinuation(
  lines: string[],
  displayLines: string[],
  index: number,
  classifierConfig?: ReceiptClassifierConfig,
): { amount: number; endIndex: number } | null {
  let amount: number | null = null
  let endIndex = index

  for (let offset = 1; offset <= 3; offset += 1) {
    const nextIndex = index + offset
    const line = lines[nextIndex]
    if (!line) break
    const displayLine = displayLines[nextIndex] ?? line
    if (isReceiptSummaryOrPaymentLine(line) || isReceiptSummaryOrPaymentLine(displayLine)) break

    const trailingAmount = extractTrailingAmount(line) ?? extractTrailingAmount(displayLine)
    if (trailingAmount == null) break
    if (!isPriceContinuationLine(line, classifierConfig) && !isPriceContinuationLine(displayLine, classifierConfig)) break

    const baseAmount: number = amount == null ? trailingAmount : amount
    const adjustedAmount: number | null = discountAdjustedAmount(line, baseAmount)
      ?? discountAdjustedAmount(displayLine, baseAmount)
    amount = adjustedAmount ?? trailingAmount
    endIndex = nextIndex
    if (isDiscountContinuationLine(line) || isDiscountContinuationLine(displayLine)) break
  }

  return amount != null && amount > 0 && endIndex > index ? { amount, endIndex } : null
}

function findDiscountAdjustment(
  lines: string[],
  displayLines: string[],
  index: number,
  amount: number,
): { amount: number; endIndex: number } | null {
  const nextIndex = index + 1
  const line = lines[nextIndex]
  if (!line) return null
  const displayLine = displayLines[nextIndex] ?? line
  if (!isDiscountContinuationLine(line) && !isDiscountContinuationLine(displayLine)) return null
  const adjustedAmount = discountAdjustedAmount(line, amount) ?? discountAdjustedAmount(displayLine, amount)
  return adjustedAmount != null && adjustedAmount > 0 ? { amount: adjustedAmount, endIndex: nextIndex } : null
}

function shouldSkipLineItem(
  line: string,
  displayLine: string,
  displayLabel: string,
  normalizedLabel: string,
  classifierConfig?: ReceiptClassifierConfig,
): boolean {
  if (!displayLabel || !normalizedLabel) return true
  if (isReceiptSummaryOrPaymentLine(line) || isReceiptSummaryOrPaymentLine(displayLine)) return true
  if (isReceiptMetadataLine(line) || isReceiptMetadataLine(displayLine)) return true
  if (isPriceContinuationLine(line, classifierConfig) || isPriceContinuationLine(displayLine, classifierConfig)) return true
  return hasLowValueWord(normalizedLabel, classifierConfig)
}

function shouldSkipProductLabelCandidate(
  line: string,
  displayLine: string,
  normalizedLabel: string,
  classifierConfig?: ReceiptClassifierConfig,
): boolean {
  if (!normalizedLabel) return true
  if (extractTrailingAmount(line) != null || extractTrailingAmount(displayLine) != null) return true
  if (isReceiptSummaryOrPaymentLine(line) || isReceiptSummaryOrPaymentLine(displayLine)) return true
  if (isReceiptMetadataLine(line) || isReceiptMetadataLine(displayLine)) return true
  if (isPriceContinuationLine(line, classifierConfig) || isPriceContinuationLine(displayLine, classifierConfig)) return true
  return hasLowValueWord(normalizedLabel, classifierConfig)
}

function isReceiptMetadataLine(line: string): boolean {
  return /^(?:cvr|tlf|tel|telefon|ks|bon|betjent|v\/|www|http)\b/i.test(line)
    || /\bcvr[-\s]?nr\b/i.test(line)
    || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(line)
}

function isReceiptSummaryOrPaymentLine(line: string): boolean {
  const normalized = normalizeAmountSpacing(line).toLowerCase()
  return /\b(?:total|subtotal|sum|amount due|beløb|belob|at\s+betale|til\s+betaling|i\s*alt|ialt|betaling|betalt|betalingskort|mastercard|visa|dankort|kort|mobilepay|kontant|cash|change|byttepenge|tax|vat|moms|fee|gebyr)\b/i.test(normalized)
}

function isPriceContinuationLine(line: string, classifierConfig?: ReceiptClassifierConfig): boolean {
  return isUnitPriceContinuationLine(line)
    || isDiscountContinuationLine(line)
    || isAmountOnlyContinuationLine(line, classifierConfig)
}

function isUnitPriceContinuationLine(line: string): boolean {
  return /^\s*(?:à|á|a|å|@)\s+[-+]?\d/iu.test(normalizeAmountSpacing(line))
}

function isDiscountContinuationLine(line: string): boolean {
  const amounts = extractAmountMatches(line)
  if (amounts.length === 0) return false
  return /\b(?:rabat|rabatten|discount)\b/i.test(line) || (amounts.some((amount) => amount.value < 0) && amounts.some((amount) => amount.value > 0))
}

function isAmountOnlyContinuationLine(line: string, classifierConfig?: ReceiptClassifierConfig): boolean {
  const withoutAmounts = normalizeAmountSpacing(line)
    .replace(AMOUNT_TOKEN_PATTERN, ' ')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
  const normalized = normalizeReceiptLabel(withoutAmounts, classifierConfig)
  return !normalized || hasLowValueWord(normalized, classifierConfig)
}

function hasLowValueWord(normalizedLabel: string, classifierConfig?: ReceiptClassifierConfig): boolean {
  if (!classifierConfig) return false
  return [...classifierConfig.lowValueWords].some((word) => {
    const normalizedWord = normalizeReceiptLabel(word, classifierConfig) || word
    return normalizedWord
      && (normalizedLabel === normalizedWord
        || normalizedLabel.startsWith(`${normalizedWord} `)
        || normalizedLabel.endsWith(` ${normalizedWord}`)
        || normalizedLabel.includes(` ${normalizedWord} `))
  })
}

function discountAdjustedAmount(line: string, currentAmount: number): number | null {
  const amounts = extractAmountMatches(line)
  if (!amounts.some((amount) => amount.value < 0)) return null
  const trailing = amounts[amounts.length - 1]?.value
  if (trailing != null && trailing > 0) return trailing

  const adjusted = amounts.reduce((sum, amount) => sum + (amount.value < 0 ? amount.value : 0), currentAmount)
  return adjusted > 0 ? adjusted : null
}

function inferLineQuantity(label: string): number | undefined {
  const match = normalizeAmountSpacing(label).match(/^\s*(\d{1,3})(?:\s*x)?\s+(?=\p{Letter})/iu)
  if (!match) return undefined
  const quantity = Number(match[1])
  return Number.isFinite(quantity) && quantity > 1 ? quantity : undefined
}

function joinOriginalLines(displayLines: string[], startIndex: number, endIndex: number): string {
  return displayLines.slice(startIndex, endIndex + 1).map((line) => line.trim()).filter(Boolean).join(' / ')
}

function splitReceiptLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const AMOUNT_TOKEN_PATTERN = /[-+]?\d{1,6}\s*[,.]\s*\d{2}-?/g

function stripTrailingAmountAndCurrency(line: string): string {
  const normalized = normalizeAmountSpacing(line)
  const matches = extractAmountMatches(normalized)
  const last = matches[matches.length - 1]
  if (!last || !isTrailingAmountSuffix(normalized.slice(last.end))) return normalized.trim()
  return normalized.slice(0, last.start).trim()
}

function extractTrailingAmount(line: string): number | null {
  const normalized = normalizeAmountSpacing(line)
  const matches = extractAmountMatches(normalized)
  const last = matches[matches.length - 1]
  if (!last || !isTrailingAmountSuffix(normalized.slice(last.end))) return null
  return last.value
}

function extractLastAmount(line: string): number | null {
  const matches = extractAmountMatches(line)
  return matches.length > 0 ? matches[matches.length - 1].value : null
}

function extractAmountMatches(line: string): Array<{ value: number; start: number; end: number }> {
  const normalized = normalizeAmountSpacing(line)
  return [...normalized.matchAll(AMOUNT_TOKEN_PATTERN)]
    .map((match) => {
      const raw = match[0]
      const isNegative = raw.trim().startsWith('-') || raw.trim().endsWith('-')
      const numeric = Number(raw.replace(/[+\-\s]/g, '').replace(',', '.'))
      if (!Number.isFinite(numeric)) return null
      return {
        value: isNegative ? -numeric : numeric,
        start: match.index ?? 0,
        end: (match.index ?? 0) + raw.length,
      }
    })
    .filter((match): match is { value: number; start: number; end: number } => match != null)
}

function normalizeAmountSpacing(line: string): string {
  return line
    .replace(/(\d{1,6})\s+([,.])\s*(\d{2})(?=\D|$)/g, '$1$2$3')
    .replace(/(\d{1,6})([,.])\s+(\d{2})(?=\D|$)/g, '$1$2$3')
}

function isTrailingAmountSuffix(value: string): boolean {
  return /^\s*(?:DKK|EUR|USD|GBP|SEK|NOK)?\s*[)\].,;:*#zZ]*\s*$/i.test(value)
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
