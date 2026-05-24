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

  it('parses Danish supermarket continuation lines and skips totals', () => {
    const receipt = parseReceiptText({
      rawText: [
        'REMA 1000',
        'Rema 1000, Turpinsvinget',
        'V/ Mikkel Bryld',
        'T11:88 32 14 58',
        'CVR-NR: 27964125',
        'COCA COLA ZERO',
        'å 18,00 18,00',
        ', -3,00 15,00',
        'FLASKEPANT 3.00',
        'STAY STRONG SKYR 20,00',
        'PEANUT BUTTER 25,00',
        'HAVREDRIK 11,95',
        'ÆBLEJUICE 12,95',
        'FLASKEPANT 3,00',
        'øKO OLIVENOL. 58,12',
        'CASTELLO HAVARTI',
        'å 25,00 50,00',
        'REMA 1000 RELISH 13,95',
        'øKO. RISTEDE LØG 10,09',
        '2 LURPAK SMØR',
        'å 10,00 20,00',
        'ØKO AGURK 13,00',
        'REMA 1000 øKO ÆG 31,95',
        'FAIRTRADE BANAN 10,00',
        'SUPER GLUE 31 .95',
        'SOLSIKKEBOLLER',
        'å 25,9 25,95',
        'Rabat -15,95 10,00',
        'AT BETALE 339,96',
        'MASTERCARD 339,',
        '(HERAF MOMS 67,99) z',
        '(S: 2 BON: — 20025341 22.05.26 12.43',
      ].join('\n'),
    })

    expect(receipt.totalAmount).toBe(339.96)
    expect(receipt.taxAmount).toBe(67.99)
    expect(receipt.purchaseDate).toBe('2026-05-22')
    expect(receipt.lineItems.map((item) => [item.label, item.amount])).toEqual([
      ['COCA COLA ZERO', 15],
      ['FLASKEPANT', 3],
      ['STAY STRONG SKYR', 20],
      ['PEANUT BUTTER', 25],
      ['HAVREDRIK', 11.95],
      ['ÆBLEJUICE', 12.95],
      ['FLASKEPANT', 3],
      ['øKO OLIVENOL.', 58.12],
      ['CASTELLO HAVARTI', 50],
      ['REMA 1000 RELISH', 13.95],
      ['øKO. RISTEDE LØG', 10.09],
      ['2 LURPAK SMØR', 20],
      ['ØKO AGURK', 13],
      ['REMA 1000 øKO ÆG', 31.95],
      ['FAIRTRADE BANAN', 10],
      ['SUPER GLUE', 31.95],
      ['SOLSIKKEBOLLER', 10],
    ])
    expect(receipt.lineItems.find((item) => item.label === '2 LURPAK SMØR')?.quantity).toBe(2)
    expect(receipt.lineItems.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(339.96, 2)
    expect(receipt.lineItems.some((item) => item.label === 'AT BETALE')).toBe(false)
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
