// Text folding shared by the receipt classifier, mapping import and seed so every
// stored key (normalized labels, merchant keys, classifier terms) is built the same
// way. Pure: no database access, so the seed script can use it.

/**
 * Lowercases and folds accents (é → e, ü → u) so OCR and hand-typed variants match,
 * but keeps the Danish ring on å. æ and ø don't decompose, so they're kept too.
 * Plain NFKD + stripping non-letters used to turn "blåbær" into "bla bær" and
 * "crème" into "cre me".
 */
export function foldReceiptText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/(?!\u030a)\p{M}/gu, '')
    .normalize('NFC')
}

/** Words of a folded text, keeping only letters and digits. */
export function receiptWords(value: string): string[] {
  return foldReceiptText(value)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Space-joined folded words, e.g. a classifier term or merchant name. */
export function normalizeReceiptTerm(value: string): string {
  return receiptWords(value).join(' ')
}

/**
 * Tests a `|`-separated list of terms against text. Terms longer than three letters
 * match anywhere (Danish compounds: "fuldkornsrugbrød" contains "rugbrød").
 * Three-letter terms must end a word — a compound's last part names the thing, so
 * "hytteost" is cheese and "rødvin" wine, but "skovbær" isn't shoes ("sko") and
 * "boghvede" isn't a book ("bog"). Two-letter terms must be whole words ("te" is
 * tea, "kotelette" is not).
 */
export function matchesAnyTerm(text: string, terms: string): boolean {
  let pattern = termPatternCache.get(terms)
  if (!pattern) {
    const alternatives = terms.split('|').map((term) => {
      const escaped = term.replace(/[.*+?^${}()[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
      if (term.length <= 2) return `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`
      if (term.length === 3) return `${escaped}(?![\\p{L}\\p{N}])`
      return escaped
    })
    pattern = new RegExp(alternatives.join('|'), 'iu')
    termPatternCache.set(terms, pattern)
  }
  return pattern.test(text)
}

const termPatternCache = new Map<string, RegExp>()
