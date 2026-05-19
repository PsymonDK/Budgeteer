import { describe, expect, it } from 'vitest'
import { normalizeOcrText, scoreOcrText } from './receiptOcr'

describe('receiptOcr', () => {
  it('normalizes OCR whitespace without changing receipt line order', () => {
    expect(normalizeOcrText('Milk 12,50  \r\n\n\nBread 24,95\n')).toBe('Milk 12,50\n\nBread 24,95')
  })

  it('scores item-and-amount OCR higher than noisy sideways text', () => {
    const receiptLikeText = [
      'NETTO',
      'HANDSABE 10,00',
      'LOTUS KOKKENRULLER 20,00',
      'TOTAL 30,00',
    ].join('\n')
    const noisyText = ':::c:meomooommoomx}ﬁoommmm\\_},ooo\nSSSRARSARHSAFSCHAMIAAA'

    expect(scoreOcrText(receiptLikeText)).toBeGreaterThan(scoreOcrText(noisyText))
  })
})
