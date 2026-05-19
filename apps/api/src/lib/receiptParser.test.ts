import { describe, expect, it } from 'vitest'
import { correctReceiptOcrText, isAllowedLocalAiHost, normalizeReceiptLabel, parseReceiptText } from './receiptParser'

describe('receiptParser', () => {
  it('normalizes noisy receipt labels for reusable mappings', () => {
    expect(normalizeReceiptLabel('2 x Organic Milk, 1L')).toBe('organic milk')
    expect(normalizeReceiptLabel('  RUGBRØD - ØKO  ')).toBe('rugbrød øko')
  })

  it('parses receipt text into header fields and line items', () => {
    const receipt = parseReceiptText({
      rawText: [
        'Netto Copenhagen',
        '18.05.2026',
        'Milk 12,50',
        'Bread 24,95',
        'MOMS 7,49',
        'TOTAL 37,45 DKK',
      ].join('\n'),
    })

    expect(receipt.merchantName).toBe('Netto Copenhagen')
    expect(receipt.purchaseDate).toBe('2026-05-18')
    expect(receipt.currencyCode).toBe('DKK')
    expect(receipt.totalAmount).toBe(37.45)
    expect(receipt.taxAmount).toBe(7.49)
    expect(receipt.lineItems).toEqual([
      expect.objectContaining({ label: 'Milk', amount: 12.5, normalizedLabel: 'milk' }),
      expect.objectContaining({ label: 'Bread', amount: 24.95, normalizedLabel: 'bread' }),
    ])
  })

  it('uses corrected OCR text for parsing while keeping raw line labels visible', () => {
    const classifierConfig = {
      noiseTokens: new Set<string>(),
      lowValueWords: new Set(['total']),
      ocrAliases: new Map([['totlet', 'toilet'], ['chilt', 'chili']]),
    }
    const rawText = [
      'Netto',
      'LOTUS TOTLET 20,00',
      'CHILT SAUCE 12,95',
      'TOTAL 32,95',
    ].join('\n')
    const correctedText = correctReceiptOcrText(rawText, classifierConfig)
    const receipt = parseReceiptText({ rawText: correctedText, displayRawText: rawText }, classifierConfig)

    expect(correctedText).toContain('toilet')
    expect(correctedText).toContain('chili')
    expect(receipt.lineItems).toEqual([
      expect.objectContaining({ originalText: 'LOTUS TOTLET 20,00', label: 'LOTUS TOTLET', normalizedLabel: 'lotus toilet' }),
      expect.objectContaining({ originalText: 'CHILT SAUCE 12,95', label: 'CHILT SAUCE', normalizedLabel: 'chili sauce' }),
    ])
  })

  it('uses receipt currency when detected before applying the fallback currency', () => {
    const euroReceipt = parseReceiptText({
      rawText: [
        'Corner Market',
        'Coffee 4,50',
        'TOTAL 4,50 EUR',
      ].join('\n'),
      fallbackCurrency: 'DKK',
    })
    const danishReceipt = parseReceiptText({
      rawText: [
        'Netto',
        'MOMS UDGØR 100,80',
        'KORT UDEN GEBYR 504,00 kr',
      ].join('\n'),
      fallbackCurrency: 'EUR',
    })

    expect(euroReceipt.currencyCode).toBe('EUR')
    expect(danishReceipt.currencyCode).toBe('DKK')
  })

  it('falls back to the provided household currency when no receipt currency is detected', () => {
    const receipt = parseReceiptText({
      rawText: [
        'Receipt',
        'Coffee 4,50',
        'TOTAL 4,50',
      ].join('\n'),
      fallbackCurrency: 'EUR',
    })

    expect(receipt.currencyCode).toBe('EUR')
  })

  it('keeps receipt AI endpoints local-only', () => {
    expect(isAllowedLocalAiHost('localhost')).toBe(true)
    expect(isAllowedLocalAiHost('ollama')).toBe(true)
    expect(isAllowedLocalAiHost('api.openai.com')).toBe(false)
    expect(isAllowedLocalAiHost('example.com')).toBe(false)
  })

  it('returns a reviewable draft when no OCR text or local model output exists', () => {
    const receipt = parseReceiptText({ fileName: 'receipt.jpg', fileBase64: 'abc', mimeType: 'image/jpeg' })
    expect(receipt.confidence).toBe('LOW')
    expect(receipt.lineItems).toHaveLength(0)
    expect(receipt.notes[0]).toContain('No receipt text was available')
  })
})
