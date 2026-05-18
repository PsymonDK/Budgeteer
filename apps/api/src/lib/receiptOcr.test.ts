import { describe, expect, it } from 'vitest'
import { normalizeOcrText } from './receiptOcr'

describe('receiptOcr', () => {
  it('normalizes OCR whitespace without changing receipt line order', () => {
    expect(normalizeOcrText('Milk 12,50  \r\n\n\nBread 24,95\n')).toBe('Milk 12,50\n\nBread 24,95')
  })
})
