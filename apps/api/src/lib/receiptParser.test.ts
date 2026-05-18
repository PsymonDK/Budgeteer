import { describe, expect, it } from 'vitest'
import { isAllowedLocalAiHost, normalizeReceiptLabel, parseReceiptText } from './receiptParser'

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
