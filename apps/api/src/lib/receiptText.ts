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

// ── Receipt label normalization ──────────────────────────────────────────────
// Everything that builds a stored key (line items, category mappings, merchant keys,
// imports, the seed) goes through normalizeReceiptLabel / merchantMappingKey, so
// the same text always produces the same key.

export interface ReceiptClassifierConfig {
  noiseTokens: Set<string>
  lowValueWords: Set<string>
  ocrAliases: Map<string, string>
}

export const FALLBACK_NOISE_TOKENS = [
  'stk',
  'pcs',
  'pc',
  'kg',
  'g',
  'l',
  'ml',
  'cl',
  'cm',
  'mm',
  'ltr',
  'liter',
  'gram',
  'varenr',
  'vare',
  'nr',
  'dk',
  'kr',
  'dkk',
]
export const FALLBACK_LOW_VALUE_WORDS = [
  'total',
  'subtotal',
  'sum',
  'i alt',
  'ialt',
  'at betale',
  'betale',
  'til betaling',
  'betaling',
  'betalt',
  'beløb',
  'belob',
  'change',
  'cash',
  'card',
  'kort',
  'kreditkort',
  'betalingskort',
  'visa',
  'mastercard',
  'dankort',
  'mobilepay',
  'kontant',
  'tax',
  'vat',
  'moms',
  'rabat',
  'rabatten',
  'retur',
]
export const FALLBACK_OCR_ALIASES: Array<[string, string]> = [
  ['totlet', 'toilet'],
  ['tollet', 'toilet'],
  ['toiletpapii', 'toiletpapir'],
  ['chilt', 'chili'],
  ['k kkenruller', 'køkkenruller'],
  ['kokkenruller', 'køkkenruller'],
  ['k@kkenruller', 'køkkenruller'],
  ['minimalk', 'minimælk'],
  ['handsebe', 'handsæbe'],
  ['handsaebe', 'handsæbe'],
  ['sonderyjsk', 'sønderjysk'],
  ['spegopol', 'spegepøl'],
  ['oksespegepol', 'oksespegepøl'],
]
export const FALLBACK_CLASSIFIER_CONFIG: ReceiptClassifierConfig = {
  noiseTokens: new Set(FALLBACK_NOISE_TOKENS),
  lowValueWords: new Set(FALLBACK_LOW_VALUE_WORDS),
  ocrAliases: new Map(FALLBACK_OCR_ALIASES),
}

export function fallbackReceiptClassifierConfig(): ReceiptClassifierConfig {
  return {
    noiseTokens: new Set(FALLBACK_NOISE_TOKENS),
    lowValueWords: new Set(FALLBACK_LOW_VALUE_WORDS),
    ocrAliases: new Map(FALLBACK_OCR_ALIASES),
  }
}

export function normalizeReceiptLabel(value: string, config: ReceiptClassifierConfig = FALLBACK_CLASSIFIER_CONFIG): string {
  const normalized = foldReceiptText(value)
    .replace(/(?:^|\s)[a-z]{0,3}\d{4,}[a-z0-9-]*(?=\s|$)/gi, ' ')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:x|stk|pcs?|kg|g|l|ml|cl|cm|mm|ltr|liter|gram)\b/gi, ' ')
    .replace(/\b(?:x|stk|pcs?)\s*\d+(?:[,.]\d+)?\b/gi, ' ')
    .replace(/\b\d+[,.]\d{2}\b(?=\s*$)/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Multi-word noise terms (e.g. "pr kg") are removed as phrases before the
  // per-token filter, which only sees single words
  let phraseFree = ` ${normalized} `
  for (const noise of config.noiseTokens) {
    if (noise.includes(' ')) phraseFree = phraseFree.split(` ${noise} `).join(' ')
  }
  const withoutNoise = phraseFree
    .split(/\s+/)
    .filter((token) => token.length > 1 && !config.noiseTokens.has(token))
    .join(' ')
  return applyOcrAliases(withoutNoise, config.ocrAliases)
}

export function merchantMappingKey(merchantName?: string | null, config?: ReceiptClassifierConfig): string {
  return normalizeReceiptLabel(merchantName ?? '', config)
}

function applyOcrAliases(label: string, aliases: Map<string, string>): string {
  if (!label || aliases.size === 0) return label
  const tokens = label.split(/\s+/).filter(Boolean)
  const aliasEntries = [...aliases.entries()]
    .map(([source, target]) => ({
      sourceTokens: source.split(/\s+/).filter(Boolean),
      targetTokens: target.split(/\s+/).filter(Boolean),
    }))
    .filter((alias) => alias.sourceTokens.length > 0 && alias.targetTokens.length > 0)
    .sort((a, b) => b.sourceTokens.length - a.sourceTokens.length)

  const output: string[] = []
  for (let index = 0; index < tokens.length;) {
    const alias = aliasEntries.find((candidate) =>
      candidate.sourceTokens.every((token, offset) => tokens[index + offset] === token),
    )
    if (alias) {
      output.push(...alias.targetTokens)
      index += alias.sourceTokens.length
    } else {
      output.push(tokens[index])
      index += 1
    }
  }

  return output.join(' ')
}

/** One side of an OCR alias ("k@kkenruller" keeps its @, which OCR produces for ø). */
export function normalizeAliasSide(value: string): string {
  return foldReceiptText(value.trim())
    .replace(/[^\p{Letter}\p{Number}\s@]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** An OCR alias term "source=>target" (or "source->target"), or null when malformed. */
export function parseOcrAlias(value: string): { source: string; target: string } | null {
  const match = value.trim().toLowerCase().match(/^(.+?)(?:=>|->)(.+)$/)
  if (!match) return null
  const source = normalizeAliasSide(match[1])
  const target = normalizeAliasSide(match[2])
  if (!source || !target || source === target) return null
  return { source, target }
}

/**
 * A classifier term as stored for its type (admin edits, CSV import and seed all use
 * this): folded words, or "source=>target" for OCR aliases. Null when unusable.
 */
export function normalizeClassifierTerm(termType: string | null | undefined, value: string): string | null {
  if (termType === 'OCR_ALIAS') {
    const alias = parseOcrAlias(value)
    return alias ? `${alias.source}=>${alias.target}` : null
  }
  const term = normalizeReceiptTerm(value)
  if (!term || term.length > 80 || /^\d+$/.test(term)) return null
  return term
}
