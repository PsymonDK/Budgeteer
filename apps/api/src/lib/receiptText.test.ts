import { describe, expect, it, vi } from 'vitest'

vi.mock('./prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))

import { foldReceiptText, matchesAnyTerm, normalizeReceiptTerm } from './receiptText'
import { classifierTermCandidates, fallbackReceiptClassifierConfig, normalizeReceiptLabel, suggestCategory } from './receiptClassifier'

describe('foldReceiptText', () => {
  it('keeps Danish å, æ and ø intact', () => {
    expect(foldReceiptText('Blåbær')).toBe('blåbær')
    expect(foldReceiptText('HÅNDSÆBE')).toBe('håndsæbe')
    expect(foldReceiptText('Rugbrød')).toBe('rugbrød')
  })

  it('folds other accents instead of splitting words', () => {
    expect(foldReceiptText('Crème fraîche')).toBe('creme fraiche')
    expect(normalizeReceiptTerm('Café  Noir!')).toBe('cafe noir')
  })
})

describe('normalizeReceiptLabel', () => {
  it('no longer breaks å into two words', () => {
    expect(normalizeReceiptLabel('Håndsæbe 250 ml')).toBe('håndsæbe')
    expect(normalizeReceiptLabel('Blåbær 125g')).toBe('blåbær')
  })
})

describe('matchesAnyTerm', () => {
  it('lets three-letter terms match compound heads but not word starts', () => {
    expect(matchesAnyTerm('hytteost', 'ost')).toBe(true)
    expect(matchesAnyTerm('rødvin', 'vin')).toBe(true)
    expect(matchesAnyTerm('gummisko', 'sko')).toBe(true)
    expect(matchesAnyTerm('skovbær', 'sko')).toBe(false)
    expect(matchesAnyTerm('boghvede', 'bog')).toBe(false)
  })

  it('requires two-letter terms to be whole words', () => {
    expect(matchesAnyTerm('grøn te', 'te')).toBe(true)
    expect(matchesAnyTerm('kotelette', 'te')).toBe(false)
  })

  it('matches longer terms anywhere', () => {
    expect(matchesAnyTerm('fuldkornsrugbrød', 'rugbrød|brød')).toBe(true)
  })
})

describe('suggestCategory', () => {
  const categories = [
    {
      id: 'care', name: 'Personal care', isSystemWide: true, householdId: null,
      receiptSubcategories: [{ id: 'hyg', name: 'Hygiene', isSystemWide: true, householdId: null }],
    },
    {
      id: 'clothes', name: 'Clothing', isSystemWide: true, householdId: null,
      receiptSubcategories: [{ id: 'shoe', name: 'Shoes', isSystemWide: true, householdId: null }],
    },
  ]

  it('matches rules containing å now that labels keep it', () => {
    expect(suggestCategory(normalizeReceiptLabel('Håndsæbe'), 'Netto', categories)?.categoryId).toBe('care')
  })

  it('does not file berries under shoes', () => {
    expect(suggestCategory(normalizeReceiptLabel('Skovbær'), null, categories)?.categoryId).not.toBe('clothes')
    expect(suggestCategory(normalizeReceiptLabel('Gummisko'), null, categories)?.categoryId).toBe('clothes')
  })
})

describe('classifierTermCandidates', () => {
  const config = fallbackReceiptClassifierConfig()

  it('learns noise from a trimmed label', () => {
    const { noise } = classifierTermCandidates([{ originalText: 'KAFFE ØKO X7A 49,95', normalizedLabel: 'kaffe øko' }], config)
    expect([...noise]).toEqual(['x7a'])
  })

  it('learns nothing from a renamed label, so the product name never becomes noise', () => {
    const { noise } = classifierTermCandidates([{ originalText: 'KYLLINGEBRYST 45,00', normalizedLabel: 'chicken breast' }], config)
    expect(noise.size).toBe(0)
  })
})
