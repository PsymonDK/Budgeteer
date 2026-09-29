import { describe, expect, it } from 'vitest'
import {
  extractAmountMatches,
  inferAmountByKeywords,
  inferDate,
  mergeAiParse,
  normalizeIsoDate,
  parseAmountToken,
  parseReceiptText,
  type ParsedReceipt,
} from './receiptParser'

// Regression tests for bugs found in the 2026-09 receipt review.

describe('amount tokens', () => {
  it('reads thousands separators instead of the last digits', () => {
    expect(extractAmountMatches('Fjernsyn 1.234,50').map((m) => m.value)).toEqual([1234.5])
    expect(extractAmountMatches('TV 1,234.50').map((m) => m.value)).toEqual([1234.5])
    expect(parseAmountToken('1.234.567,89')).toBe(1234567.89)
  })

  it('never starts a token inside a longer number', () => {
    expect(extractAmountMatches('Ref 1234567,50')).toEqual([])
  })

  it('keeps plain and negative amounts working', () => {
    expect(extractAmountMatches('Milk 12,95').map((m) => m.value)).toEqual([12.95])
    expect(extractAmountMatches('Rabat -5,00').map((m) => m.value)).toEqual([-5])
    expect(extractAmountMatches('Pant 3,00-').map((m) => m.value)).toEqual([-3])
    expect(extractAmountMatches('Kaffe 31 .95').map((m) => m.value)).toEqual([31.95])
  })

  it('groups with spaces only on summary lines', () => {
    expect(inferAmountByKeywords(['TOTAL 1 234,50'], ['total'])).toBe(1234.5)
    // On an item line "2 125,00" is a quantity and a price, not 2125
    expect(extractAmountMatches('2 125,00').map((m) => m.value)).toEqual([125])
  })
})

describe('summary keywords match whole words', () => {
  it('does not read "coffee" as a fee or "taxi" as tax', () => {
    const receipt = parseReceiptText({ rawText: ['Cafe', 'Coffee beans 35,00', 'Taxi voucher 20,00', 'TOTAL 55,00'].join('\n') })
    expect(receipt.feeAmount).toBeNull()
    expect(receipt.taxAmount).toBeNull()
    expect(receipt.totalAmount).toBe(55)
  })

  it('does not read "Sumatra" as a sum', () => {
    expect(inferAmountByKeywords(['Sumatra kaffe 49,00'], ['sum'])).toBeNull()
    expect(inferAmountByKeywords(['Sum 49,00'], ['sum'])).toBe(49)
  })

  it('still finds multi-word keywords', () => {
    expect(inferAmountByKeywords(['AT  BETALE 120,00'], ['at betale'])).toBe(120)
  })
})

describe('dates', () => {
  it('rejects impossible dates instead of rolling them over', () => {
    expect(inferDate(['31.02.26'])).toBeNull()
    expect(inferDate(['29.02.2028'])).toBe('2028-02-29')
  })

  it('detects ISO dates', () => {
    expect(inferDate(['Dato: 2026-03-12 14:05'])).toBe('2026-03-12')
  })

  it('normalizeIsoDate only accepts real YYYY-MM-DD dates', () => {
    expect(normalizeIsoDate('2026-03-12')).toBe('2026-03-12')
    expect(normalizeIsoDate('12/03/2026')).toBeNull()
    expect(normalizeIsoDate('2026-02-30')).toBeNull()
    expect(normalizeIsoDate(42)).toBeNull()
  })
})

describe('mergeAiParse', () => {
  const deterministic: ParsedReceipt = {
    merchantName: 'Netto',
    purchaseDate: '2026-03-12',
    totalAmount: 37.95,
    taxAmount: null,
    feeAmount: null,
    currencyCode: 'DKK',
    confidence: 'MEDIUM',
    notes: [],
    lineItems: [{ originalText: 'Milk 12,95', label: 'Milk', normalizedLabel: 'milk', amount: 12.95, confidence: 'MEDIUM' }],
  }
  const empty: ParsedReceipt = {
    merchantName: null, purchaseDate: null, totalAmount: null, taxAmount: null, feeAmount: null,
    currencyCode: 'DKK', confidence: 'LOW', notes: [], lineItems: [],
  }

  it('keeps the detected lines when the AI returns none', () => {
    const merged = mergeAiParse(empty, deterministic)
    expect(merged.lineItems).toHaveLength(1)
    expect(merged.merchantName).toBe('Netto')
    expect(merged.purchaseDate).toBe('2026-03-12')
  })

  it('ignores an invalid AI date', () => {
    expect(mergeAiParse({ ...empty, purchaseDate: 'last Tuesday' }, deterministic).purchaseDate).toBe('2026-03-12')
  })

  it('prefers the AI where it produced values', () => {
    const ai: ParsedReceipt = { ...empty, merchantName: 'Netto Nørrebro', lineItems: [{ ...deterministic.lineItems[0], label: 'Mælk' }], confidence: 'HIGH' }
    const merged = mergeAiParse(ai, deterministic)
    expect(merged.merchantName).toBe('Netto Nørrebro')
    expect(merged.lineItems[0].label).toBe('Mælk')
    expect(merged.totalAmount).toBe(37.95)
  })
})
