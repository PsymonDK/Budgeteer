import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import type { ParsedReceipt, ParsedReceiptLineItem, ReceiptConfidence } from './receiptParser'

interface CategoryCandidate {
  id: string
  name: string
  isSystemWide: boolean
  householdId: string | null
  receiptSubcategories: Array<{ id: string; name: string; isSystemWide: boolean; householdId: string | null }>
}

interface MappingCandidate {
  scopeKey: string
  householdId: string | null
  categoryId: string
  subcategoryId: string | null
  normalizedLabel: string
  merchantKey: string
  hitCount: number
  lastUsedAt: Date
}

interface CategorySuggestion {
  categoryId: string
  subcategoryId?: string | null
  confidence?: ReceiptConfidence
}

export interface ReceiptClassifierConfig {
  noiseTokens: Set<string>
  lowValueWords: Set<string>
  ocrAliases: Map<string, string>
}

const FUZZY_MIN_LABEL_SIMILARITY = 0.66
const FUZZY_MIN_SCORE = 0.82
const FALLBACK_NOISE_TOKENS = [
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
const FALLBACK_LOW_VALUE_WORDS = [
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
const FALLBACK_OCR_ALIASES: Array<[string, string]> = [
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
const FALLBACK_CLASSIFIER_CONFIG: ReceiptClassifierConfig = {
  noiseTokens: new Set(FALLBACK_NOISE_TOKENS),
  lowValueWords: new Set(FALLBACK_LOW_VALUE_WORDS),
  ocrAliases: new Map(FALLBACK_OCR_ALIASES),
}

type ReceiptClassifierTermType = 'NOISE_TOKEN' | 'LOW_VALUE_WORD' | 'OCR_ALIAS'

export function fallbackReceiptClassifierConfig(): ReceiptClassifierConfig {
  return {
    noiseTokens: new Set(FALLBACK_NOISE_TOKENS),
    lowValueWords: new Set(FALLBACK_LOW_VALUE_WORDS),
    ocrAliases: new Map(FALLBACK_OCR_ALIASES),
  }
}

export async function loadReceiptClassifierConfig(householdId: string): Promise<ReceiptClassifierConfig> {
  const delegate = (prisma as any).receiptClassifierTerm
  if (!delegate?.findMany) return FALLBACK_CLASSIFIER_CONFIG

  const rows = await delegate.findMany({
    where: {
      OR: [
        { scopeKey: 'system' },
        { scopeKey: householdId },
      ],
    },
    select: { scopeKey: true, termType: true, term: true, isActive: true },
    orderBy: [{ term: 'asc' }],
  }) as Array<{ scopeKey: string; termType: ReceiptClassifierTermType; term: string; isActive: boolean }>

  if (rows.length === 0) return FALLBACK_CLASSIFIER_CONFIG
  const config: ReceiptClassifierConfig = { noiseTokens: new Set(), lowValueWords: new Set(), ocrAliases: new Map() }
  for (const row of rows.sort((a, b) => Number(a.scopeKey !== 'system') - Number(b.scopeKey !== 'system'))) {
    const term = normalizeClassifierTerm(row.term)
    if (!term) continue
    if (row.termType === 'OCR_ALIAS') {
      const alias = parseOcrAliasTerm(term)
      if (!alias) continue
      if (row.scopeKey === householdId && !row.isActive) {
        config.ocrAliases.delete(alias.source)
      } else if (row.isActive) {
        config.ocrAliases.set(alias.source, alias.target)
      }
      continue
    }
    const target = row.termType === 'NOISE_TOKEN' ? config.noiseTokens : config.lowValueWords
    if (row.scopeKey === householdId && !row.isActive) {
      target.delete(term)
    } else if (row.isActive) {
      target.add(term)
    }
  }
  if (config.noiseTokens.size === 0) config.noiseTokens = new Set(FALLBACK_NOISE_TOKENS)
  if (config.lowValueWords.size === 0) config.lowValueWords = new Set(FALLBACK_LOW_VALUE_WORDS)
  if (config.ocrAliases.size === 0) config.ocrAliases = new Map(FALLBACK_OCR_ALIASES)
  return config
}

export function normalizeReceiptLabel(value: string, config: ReceiptClassifierConfig = FALLBACK_CLASSIFIER_CONFIG): string {
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/(?:^|\s)[a-z]{0,3}\d{4,}[a-z0-9-]*(?=\s|$)/gi, ' ')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:x|stk|pcs?|kg|g|l|ml|cl|cm|mm|ltr|liter|gram)\b/gi, ' ')
    .replace(/\b(?:x|stk|pcs?)\s*\d+(?:[,.]\d+)?\b/gi, ' ')
    .replace(/\b\d+[,.]\d{2}\b(?=\s*$)/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const withoutNoise = normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !config.noiseTokens.has(token))
    .join(' ')
  return applyOcrAliases(withoutNoise, config.ocrAliases)
}

export function correctReceiptOcrText(value: string, config: ReceiptClassifierConfig = FALLBACK_CLASSIFIER_CONFIG): string {
  if (!value || config.ocrAliases.size === 0) return value
  const aliases = [...config.ocrAliases.entries()]
    .filter(([source, target]) => source && target && source !== target)
    .sort((a, b) => b[0].length - a[0].length)

  let corrected = value
  for (const [source, target] of aliases) {
    const sourcePattern = source.split(/\s+/).filter(Boolean).map(escapeRegExp).join('\\s+')
    if (!sourcePattern) continue
    const boundaryPattern = `(^|[^\\p{Letter}\\p{Number}@])(${sourcePattern})(?=$|[^\\p{Letter}\\p{Number}@])`
    corrected = corrected.replace(new RegExp(boundaryPattern, 'giu'), (_match, prefix: string) => `${prefix}${target}`)
  }
  return corrected
}

export function merchantMappingKey(merchantName?: string | null, config?: ReceiptClassifierConfig): string {
  return normalizeReceiptLabel(merchantName ?? '', config)
}

export async function applyCategorySuggestions(receipt: ParsedReceipt, householdId: string): Promise<ParsedReceipt> {
  if (receipt.lineItems.length === 0) return receipt

  const [categories, rawMappings, classifierConfig] = await Promise.all([
    prisma.category.findMany({
      where: {
        categoryType: 'EXPENSE',
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
      },
      select: {
        id: true,
        name: true,
        isSystemWide: true,
        householdId: true,
        receiptSubcategories: {
          where: { isActive: true, OR: [{ isSystemWide: true }, { householdId }] },
          select: { id: true, name: true, isSystemWide: true, householdId: true },
          orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
        },
      },
    }),
    prisma.receiptCategoryMapping.findMany({
      where: { OR: [{ scopeKey: 'system' }, { scopeKey: householdId }] },
      select: { scopeKey: true, householdId: true, categoryId: true, subcategoryId: true, normalizedLabel: true, merchantKey: true, hitCount: true, lastUsedAt: true },
      orderBy: [{ hitCount: 'desc' }, { lastUsedAt: 'desc' }],
      take: 2000,
    }),
    loadReceiptClassifierConfig(householdId),
  ])

  const mappings = rawMappings.filter((mapping) => isValidSuggestion(mapping, categories))
  const merchantKey = merchantMappingKey(receipt.merchantName, classifierConfig)
  const normalizedItems = receipt.lineItems.map((item) => ({
    ...item,
    normalizedLabel: normalizeReceiptLabel(item.label, classifierConfig),
  }))
  const firstPassItems = normalizedItems.map((item) => classifyWithoutAi(item, receipt.merchantName, merchantKey, categories, mappings, classifierConfig))
  const aiIndexes = firstPassItems
    .map((item, index) => (!item.categoryId ? index : -1))
    .filter((index) => index >= 0)

  if (aiIndexes.length === 0) {
    return { ...receipt, lineItems: firstPassItems }
  }

  try {
    const aiSuggestions = await classifyWithLocalAi(receipt, firstPassItems, aiIndexes, categories)
    if (aiSuggestions.size === 0) return { ...receipt, lineItems: firstPassItems }

    const withAi = firstPassItems.map((item, index) => {
      if (item.categoryId) return item
      const suggestion = aiSuggestions.get(index)
      return suggestion ? { ...item, ...suggestion } : item
    })
    return { ...receipt, lineItems: withAi }
  } catch (err) {
    return {
      ...receipt,
      notes: [...receipt.notes, err instanceof Error ? err.message : 'Local AI receipt categorization failed.'],
      lineItems: firstPassItems,
    }
  }
}

export async function learnReceiptMappings(args: {
  householdId: string
  merchantName?: string | null
  items: Array<{ originalText?: string; label?: string; normalizedLabel: string; categoryId?: string | null; subcategoryId?: string | null; isIgnored?: boolean }>
}) {
  const classifierConfig = await loadReceiptClassifierConfig(args.householdId)
  const merchantKey = merchantMappingKey(args.merchantName, classifierConfig)
  const usable = args.items.filter((item) => item.categoryId && !item.isIgnored && item.normalizedLabel)

  for (const item of usable) {
    await prisma.receiptCategoryMapping.upsert({
      where: {
        scopeKey_normalizedLabel_merchantKey: {
          scopeKey: args.householdId,
          normalizedLabel: item.normalizedLabel,
          merchantKey,
        },
      },
      create: {
        scopeKey: args.householdId,
        householdId: args.householdId,
        normalizedLabel: item.normalizedLabel,
        merchantKey,
        categoryId: item.categoryId!,
        subcategoryId: item.subcategoryId ?? null,
        confidence: new Decimal(1),
      },
      update: {
        categoryId: item.categoryId!,
        subcategoryId: item.subcategoryId ?? null,
        hitCount: { increment: 1 },
        confidence: new Decimal(1),
        lastUsedAt: new Date(),
      },
    })
  }

  await learnReceiptClassifierTerms(args.householdId, args.items, classifierConfig)
}

function classifyWithoutAi(
  item: ParsedReceiptLineItem,
  merchantName: string | null | undefined,
  merchantKey: string,
  categories: CategoryCandidate[],
  mappings: MappingCandidate[],
  classifierConfig: ReceiptClassifierConfig,
): ParsedReceiptLineItem {
  const exactSameMerchant = findBestExactMapping(item.normalizedLabel, mappings, (mapping) => mapping.merchantKey === merchantKey)
  if (exactSameMerchant) {
    return { ...item, ...mappingToSuggestion(exactSameMerchant), confidence: bumpConfidence(item.confidence) }
  }

  const exactAnyMerchant = findBestExactMapping(item.normalizedLabel, mappings)
  if (exactAnyMerchant) {
    return { ...item, ...mappingToSuggestion(exactAnyMerchant), confidence: bumpConfidence(item.confidence) }
  }

  const householdMappings = mappings.filter((mapping) => mapping.scopeKey !== 'system')
  const globalMappings = mappings.filter((mapping) => mapping.scopeKey === 'system')
  const fuzzy = findFuzzyMapping(item.normalizedLabel, merchantKey, householdMappings)
    ?? findFuzzyMapping(item.normalizedLabel, merchantKey, globalMappings)
  if (fuzzy) {
    return { ...item, ...mappingToSuggestion(fuzzy.mapping), confidence: fuzzy.confidence }
  }

  const ruleSuggestion = suggestCategory(item.normalizedLabel, merchantName, categories, classifierConfig)
  return ruleSuggestion ? { ...item, ...ruleSuggestion, confidence: ruleSuggestion.confidence ?? item.confidence } : item
}

function findBestExactMapping(
  label: string,
  mappings: MappingCandidate[],
  predicate: (mapping: MappingCandidate) => boolean = () => true,
): MappingCandidate | undefined {
  const candidates = mappings.filter((mapping) => mapping.normalizedLabel === label && predicate(mapping))
  return candidates.find((mapping) => mapping.scopeKey !== 'system') ?? candidates.find((mapping) => mapping.scopeKey === 'system')
}

function findFuzzyMapping(label: string, merchantKey: string, mappings: MappingCandidate[]) {
  let best: { mapping: MappingCandidate; labelSimilarity: number; score: number; sameMerchant: boolean } | null = null
  for (const mapping of mappings) {
    if (mapping.normalizedLabel === label) continue
    const labelSimilarity = normalizedSimilarity(label, mapping.normalizedLabel)
    if (labelSimilarity < FUZZY_MIN_LABEL_SIMILARITY) continue

    const sameMerchant = Boolean(mapping.merchantKey && mapping.merchantKey === merchantKey)
    const merchantBoost = sameMerchant ? 0.10 : 0
    const usageBoost = Math.min(Math.log1p(mapping.hitCount) / 80, 0.06)
    const recencyBoost = recencyScore(mapping.lastUsedAt) * 0.04
    const score = labelSimilarity + merchantBoost + usageBoost + recencyBoost
    if (score >= FUZZY_MIN_SCORE && (!best || score > best.score)) {
      best = { mapping, labelSimilarity, score, sameMerchant }
    }
  }

  if (!best) return null
  return {
    mapping: best.mapping,
    confidence: (best.sameMerchant && best.score >= 0.9) || best.labelSimilarity >= 0.92 ? 'HIGH' as const : 'MEDIUM' as const,
  }
}

async function classifyWithLocalAi(
  receipt: ParsedReceipt,
  lineItems: ParsedReceiptLineItem[],
  aiIndexes: number[],
  categories: CategoryCandidate[],
): Promise<Map<number, CategorySuggestion>> {
  if (process.env.RECEIPT_AI_CATEGORIZE !== 'true') return new Map()
  const baseUrl = process.env.LOCAL_AI_BASE_URL
  const model = process.env.LOCAL_AI_MODEL
  if (!baseUrl || !model) return new Map()

  const url = new URL(baseUrl)
  if (!isAllowedLocalAiHost(url.hostname)) {
    throw new Error('LOCAL_AI_BASE_URL must point to a local/self-hosted model endpoint')
  }

  const categoryChoices = categories.map((category) => ({
    id: category.id,
    name: category.name,
    subcategories: category.receiptSubcategories.map((subcategory) => ({ id: subcategory.id, name: subcategory.name })),
  }))
  const items = aiIndexes.map((index) => ({
    index,
    label: lineItems[index].label,
    normalizedLabel: lineItems[index].normalizedLabel,
    amount: lineItems[index].amount,
  }))
  const prompt = [
    'Classify receipt line items into the provided Budgeteer expense categories.',
    'Return JSON only. Choose only categoryId and subcategoryId values from the allowed list. Use null when no safe match exists.',
    'Do not create categories. Do not change labels, amounts, totals, dates, or merchant values.',
    `Merchant: ${receipt.merchantName ?? 'Unknown'}`,
    `Allowed categories: ${JSON.stringify(categoryChoices)}`,
    `Line items: ${JSON.stringify(items)}`,
  ].join('\n\n')

  const payload = {
    model,
    prompt,
    stream: false,
    format: {
      type: 'object',
      additionalProperties: false,
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'number' },
              categoryId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              subcategoryId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              confidence: { type: 'number' },
            },
            required: ['index', 'categoryId', 'subcategoryId', 'confidence'],
          },
        },
      },
      required: ['suggestions'],
    },
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
    if (!response.ok) throw new Error(`Local AI categorizer failed with ${response.status}`)
    const data = await response.json() as { response?: string }
    if (!data.response) return new Map()
    return normalizeAiSuggestions(data.response, aiIndexes, categories)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeAiSuggestions(rawJson: string, aiIndexes: number[], categories: CategoryCandidate[]): Map<number, CategorySuggestion> {
  const parsed = JSON.parse(rawJson) as { suggestions?: unknown }
  const allowedIndexes = new Set(aiIndexes)
  const suggestions = new Map<number, CategorySuggestion>()
  if (!Array.isArray(parsed.suggestions)) return suggestions

  for (const raw of parsed.suggestions) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as { index?: unknown; categoryId?: unknown; subcategoryId?: unknown; confidence?: unknown }
    const index = typeof candidate.index === 'number' ? candidate.index : Number(candidate.index)
    if (!Number.isInteger(index) || !allowedIndexes.has(index)) continue

    const confidenceScore = typeof candidate.confidence === 'number' ? candidate.confidence : Number(candidate.confidence)
    if (!Number.isFinite(confidenceScore) || confidenceScore < 0.6) continue
    const categoryId = typeof candidate.categoryId === 'string' ? candidate.categoryId : null
    const subcategoryId = typeof candidate.subcategoryId === 'string' ? candidate.subcategoryId : null
    if (!categoryId) continue

    const suggestion = { categoryId, subcategoryId, confidence: confidenceScore >= 0.85 ? 'HIGH' as const : 'MEDIUM' as const }
    if (isValidSuggestion(suggestion, categories)) {
      suggestions.set(index, suggestion)
    }
  }
  return suggestions
}

function isValidSuggestion(
  suggestion: { scopeKey?: string; categoryId: string; subcategoryId?: string | null },
  categories: CategoryCandidate[],
): boolean {
  const category = categories.find((candidate) => candidate.id === suggestion.categoryId)
  if (!category) return false
  const isGlobal = suggestion.scopeKey === 'system'
  if (isGlobal && !category.isSystemWide) return false
  if (!suggestion.subcategoryId) return true
  const subcategory = category.receiptSubcategories.find((candidate) => candidate.id === suggestion.subcategoryId)
  if (!subcategory) return false
  return !isGlobal || subcategory.isSystemWide
}

function mappingToSuggestion(mapping: MappingCandidate): CategorySuggestion {
  return { categoryId: mapping.categoryId, subcategoryId: mapping.subcategoryId }
}

function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const dice = diceCoefficient(a, b)
  const tokensA = new Set(a.split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.split(/\s+/).filter(Boolean))
  const tokenUnion = new Set([...tokensA, ...tokensB])
  const tokenIntersection = [...tokensA].filter((token) => tokensB.has(token)).length
  const tokenJaccard = tokenUnion.size === 0 ? 0 : tokenIntersection / tokenUnion.size
  const containment = Math.max(
    tokensA.size === 0 ? 0 : tokenIntersection / tokensA.size,
    tokensB.size === 0 ? 0 : tokenIntersection / tokensB.size,
  )
  const edit = 1 - (levenshtein(a, b) / Math.max(a.length, b.length, 1))
  const tokenEdit = tokenEditSimilarity([...tokensA], [...tokensB])
  const ocrEdit = ocrConfusionSimilarity(a, b)
  return Math.max(
    (dice * 0.36) + (tokenJaccard * 0.20) + (containment * 0.18) + (Math.max(0, edit) * 0.10) + (tokenEdit * 0.16),
    (ocrEdit * 0.72) + (tokenEdit * 0.18) + (containment * 0.10),
  )
}

function tokenEditSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB
  const longer = tokensA.length <= tokensB.length ? tokensB : tokensA
  const used = new Set<number>()
  let score = 0

  for (const token of shorter) {
    let best = 0
    let bestIndex = -1
    for (let index = 0; index < longer.length; index += 1) {
      if (used.has(index)) continue
      const candidate = tokenSimilarity(token, longer[index])
      if (candidate > best) {
        best = candidate
        bestIndex = index
      }
    }
    if (bestIndex >= 0) used.add(bestIndex)
    score += best
  }

  const coveragePenalty = shorter.length / longer.length
  return (score / shorter.length) * coveragePenalty
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length <= 2 || b.length <= 2) return a === b ? 1 : 0
  const direct = 1 - (levenshtein(a, b) / Math.max(a.length, b.length, 1))
  const ocr = ocrConfusionSimilarity(a, b)
  return Math.max(0, direct, ocr)
}

function ocrConfusionSimilarity(a: string, b: string): number {
  const aKey = ocrConfusionKey(a)
  const bKey = ocrConfusionKey(b)
  if (aKey === bKey) return 1
  return 1 - (levenshtein(aKey, bKey) / Math.max(aKey.length, bKey.length, 1))
}

function ocrConfusionKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/æ/g, 'ae')
    .replace(/ø|@/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[0º]/g, 'o')
    .replace(/[1|!]/g, 'l')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const aPairs = bigrams(a)
  const bPairs = bigrams(b)
  const bCounts = new Map<string, number>()
  bPairs.forEach((pair) => bCounts.set(pair, (bCounts.get(pair) ?? 0) + 1))

  let intersection = 0
  for (const pair of aPairs) {
    const count = bCounts.get(pair) ?? 0
    if (count > 0) {
      intersection += 1
      bCounts.set(pair, count - 1)
    }
  }
  return (2 * intersection) / (aPairs.length + bPairs.length)
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ')
  const pairs: string[] = []
  for (let i = 0; i < compact.length - 1; i += 1) pairs.push(compact.slice(i, i + 2))
  return pairs
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index)
  const curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }
  return prev[b.length]
}

function recencyScore(value: Date): number {
  const ageMs = Date.now() - value.getTime()
  if (ageMs <= 0) return 1
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1 - (ageDays / 365))
}

export function suggestCategory(
  label: string,
  merchantName: string | null | undefined,
  categories: CategoryCandidate[],
  classifierConfig: ReceiptClassifierConfig = FALLBACK_CLASSIFIER_CONFIG,
): CategorySuggestion | null {
  const haystack = `${label} ${normalizeReceiptLabel(merchantName ?? '', classifierConfig)}`
  const find = (names: string[], subcategoryNames: string[] = []) => {
    const category = names
      .map((name) => categories.find((c) => c.name.toLowerCase().includes(name)))
      .find((candidate): candidate is CategoryCandidate => Boolean(candidate))
    if (!category) return null
    const subcategory = subcategoryNames
      .map((name) => category.receiptSubcategories.find((s) => s.name.toLowerCase().includes(name)))
      .find((candidate): candidate is CategoryCandidate['receiptSubcategories'][number] => Boolean(candidate))
    return { categoryId: category.id, subcategoryId: subcategory?.id ?? null, confidence: 'MEDIUM' as const }
  }

  if (/(håndsæbe|handsæbe|shampoo|balsam|tandpasta|tandbørste|deodorant|barber|bind|tampon|vatpind|vatrondel|bodylotion|læbepomade|creme)/i.test(haystack)) {
    if (/(shampoo|balsam)/i.test(haystack)) return find(['shared household', 'personal care'], ['hair'])
    if (/(tandpasta|tandbørste)/i.test(haystack)) return find(['shared household', 'personal care'], ['dental'])
    if (/(barber)/i.test(haystack)) return find(['shared household', 'personal care'], ['shaving'])
    if (/(deodorant)/i.test(haystack)) return find(['shared household', 'personal care'], ['deodorant'])
    if (/(creme|bodylotion|læbepomade)/i.test(haystack)) return find(['shared household', 'personal care'], ['skin'])
    return find(['shared household', 'personal care'], ['hygiene'])
  }
  if (/(køkkenrulle|køkkenruller|toiletpapir|toilet papir|toilet|totlet|serviet|lommetørklæde|opvask|rengøring|rengoering|toiletrens|afkalker|klorin|skuresvamp|svamp|karklud|vaskemiddel|vaskepulver|skyllemiddel|bagepapir|madpapir|frysepose|affaldspose|affaldssæk|stanniol|folie|husholdningsfilm|batteri|elpære)/i.test(haystack)) {
    if (/(køkkenrulle|køkkenruller|toiletpapir|toilet papir|toilet|totlet|serviet|lommetørklæde)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['paper'])
    if (/(opvask|rengøring|rengoering|toiletrens|afkalker|klorin|skuresvamp|svamp|karklud)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['cleaning'])
    if (/(vaskemiddel|vaskepulver|skyllemiddel)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['laundry'])
    if (/(frysepose|affaldspose|affaldssæk|stanniol|folie|husholdningsfilm)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['bags'])
    if (/(batteri)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['batter'])
    if (/(elpære)/i.test(haystack)) return find(['shared household', 'household supplies', 'household'], ['light'])
    return find(['shared household', 'household supplies', 'household'])
  }
  if (/(bleer|vådserviet|babymad|modermælkserstatning|sutter|bamse|lego)/i.test(haystack)) {
    if (/(bleer)/i.test(haystack)) return find(['shared household', 'children', 'baby'], ['diaper'])
    if (/(babymad|modermælkserstatning)/i.test(haystack)) return find(['shared household', 'children', 'baby'], ['baby food'])
    if (/(lego|bamse)/i.test(haystack)) return find(['shared household', 'children', 'baby'], ['toy'])
    return find(['shared household', 'children', 'baby'], ['baby care'])
  }
  if (/(hundemad|kattemad|kattegrus|godbidder)/i.test(haystack)) {
    if (/(hundemad|kattemad)/i.test(haystack)) return find(['shared household', 'pets'], ['pet food', 'food'])
    return find(['shared household', 'pets'], ['pet supplies', 'supplies'])
  }
  if (/(strømper|t shirt|bukser|sko)/i.test(haystack)) {
    if (/(sko)/i.test(haystack)) return find(['shared household', 'clothing'], ['shoe'])
    return find(['shared household', 'clothing'], ['clothing'])
  }
  if (/(bog|bøger|blomster|gave)/i.test(haystack)) {
    if (/(bog|bøger)/i.test(haystack)) return find(['shared household', 'leisure', 'gift'], ['book'])
    if (/(blomster)/i.test(haystack)) return find(['shared household', 'leisure', 'gift'], ['flower'])
    return find(['shared household', 'leisure', 'gift'], ['gift'])
  }
  if (/(panodil|ipren|næsespray|hostesaft|vitamin|plaster|medicin)/i.test(haystack)) {
    return find(['shared household', 'healthcare'], ['pharmacy', 'medicine'])
  }
  if (/(milk|bread|cheese|egg|fruit|vegetable|grocery|grocer|supermarket|netto|rema|føtex|bilka|lidl|aldi|meny|coop)/i.test(haystack)) {
    if (/(mælk|maelk|yoghurt|skyr|fløde|floede|ost|smør|smoer|dairy|milk|cheese)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['dairy', 'food'])
    if (/(rugbrød|broed|brød|boller|toast|knækbrød|bread|bakery)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['bakery', 'food'])
    if (/(vegetable|carrot|potato|tomato|salad|onion|pepper|broccoli|fruit|apple|banana|orange|agurk|tomat|kartof|løg|gulerød|salat|peberfrugt|æble|banan|appelsin|pære|vindrue|jordbær|blåbær)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['vegetable'])
    if (/(beef|pork|chicken|meat|fish|bacon|sausage|oksekød|svinekød|kylling|frikadelle|pølse|bacon|spegepølse|hamburgerryg|roastbeef|filet|leverpostej|tun|makrel|laks|rejer|sild)/i.test(haystack)) {
      if (/(fish|tun|makrel|laks|rejer|sild|fisk)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['fish', 'seafood', 'meat'])
      return find(['shared household', 'food', 'grocer'], ['meat'])
    }
    if (/(remoulade|mayonnaise|ketchup|sennep|chili sauce|dressing|pesto|salsa)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['condiment', 'food'])
    if (/(kaffe|coffee|te|tea)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['coffee', 'tea', 'food'])
    if (/(cola|sodavand|soda|juice|saft|danskvand|energidrik|kakao)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['soda', 'drinks', 'food'])
    if (/(candy|sweets|chocolate|snack|chips|slik|chokolade|lakrids|vingummi|kiks|popcorn|nødder)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['candy', 'snacks'])
    if (/(beer|øl)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['beer'])
    if (/(wine|vin)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['wine'])
    if (/(alcohol|vodka|rum|gin|whisky|whiskey)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['alcohol'])
    if (/(toy|lego|game|doll)/i.test(haystack)) return find(['shared household', 'food', 'grocer'], ['toy'])
    if (/(soap|detergent|cleaner|toilet|kitchen|household|laundry)/i.test(haystack)) return find(['shared household', 'household supplies', 'household', 'food'], ['household'])
    return find(['shared household', 'food', 'grocer'], ['groceries', 'food'])
  }
  if (/(bus|train|metro|fuel|gas|parking|taxi|uber|transport|diesel|petrol|benzin)/i.test(haystack)) {
    if (/(fuel|gas|diesel|petrol|benzin)/i.test(haystack)) return find(['transport'], ['fuel'])
    if (/(bus|train|metro)/i.test(haystack)) return find(['transport'], ['public'])
    if (/parking/i.test(haystack)) return find(['transport'], ['parking'])
    if (/(taxi|uber)/i.test(haystack)) return find(['transport'], ['taxi'])
    return find(['transport'])
  }
  if (/(restaurant|cafe|coffee|burger|pizza|takeaway|dining|bar)/i.test(haystack)) {
    return find(['dining', 'food'], ['food'])
  }
  if (/(netflix|spotify|subscription|membership|icloud|google|apple)/i.test(haystack)) {
    if (/(netflix|spotify|stream)/i.test(haystack)) return find(['subscription'], ['stream'])
    if (/(software|icloud|google|apple)/i.test(haystack)) return find(['subscription'], ['software'])
    return find(['subscription'], ['membership'])
  }
  if (/(soap|detergent|cleaner|toilet|kitchen|household|laundry)/i.test(haystack)) {
    return find(['household', 'home', 'food'], ['household'])
  }
  if ([...classifierConfig.lowValueWords].some((word) => label.includes(word))) return null
  return null
}

async function learnReceiptClassifierTerms(
  householdId: string,
  items: Array<{ originalText?: string; label?: string; normalizedLabel: string; isIgnored?: boolean }>,
  classifierConfig: ReceiptClassifierConfig,
) {
  const delegate = (prisma as any).receiptClassifierTerm
  if (!delegate?.upsert) return

  const noiseCandidates = new Set<string>()
  const lowValueCandidates = new Set<string>()
  const ocrAliasSourceTokens = new Set(
    [...classifierConfig.ocrAliases.keys()].flatMap((source) => tokenizeClassifierTerms(source)),
  )
  for (const item of items) {
    const sourceText = item.originalText || item.label || item.normalizedLabel
    const sourceTokens = tokenizeClassifierTerms(sourceText)
    const normalizedTokens = new Set(tokenizeClassifierTerms(item.normalizedLabel))
    for (const token of sourceTokens) {
      if (!normalizedTokens.has(token) && !classifierConfig.noiseTokens.has(token) && !ocrAliasSourceTokens.has(token)) {
        noiseCandidates.add(token)
      }
    }
    if (item.isIgnored) {
      for (const token of normalizedTokens) {
        if (!classifierConfig.lowValueWords.has(token)) lowValueCandidates.add(token)
      }
    }
  }

  await Promise.all([
    ...[...noiseCandidates].map((term) => observeClassifierTerm(householdId, 'NOISE_TOKEN', term, 3)),
    ...[...lowValueCandidates].map((term) => observeClassifierTerm(householdId, 'LOW_VALUE_WORD', term, 3)),
  ])
}

async function observeClassifierTerm(householdId: string, termType: ReceiptClassifierTermType, rawTerm: string, activationThreshold: number) {
  const term = normalizeClassifierTerm(rawTerm)
  const delegate = (prisma as any).receiptClassifierTerm
  if (!term || !delegate?.upsert) return
  await delegate.upsert({
    where: { scopeKey_termType_term: { scopeKey: householdId, termType, term } },
    create: {
      scopeKey: householdId,
      householdId,
      termType,
      term,
      isActive: false,
      source: 'LEARNED',
      hitCount: 1,
      lastSeenAt: new Date(),
    },
    update: {
      hitCount: { increment: 1 },
      lastSeenAt: new Date(),
    },
  })
  await delegate.updateMany({
    where: { scopeKey: householdId, termType, term, hitCount: { gte: activationThreshold } },
    data: { isActive: true },
  })
}

function tokenizeClassifierTerms(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .map(normalizeClassifierTerm)
    .filter((term): term is string => Boolean(term))
}

function normalizeClassifierTerm(value: string): string | null {
  const term = value.trim().toLowerCase()
  if (!term || term.length < 2 || term.length > 80) return null
  if (/^\d+$/.test(term)) return null
  return term
}

function parseOcrAliasTerm(term: string): { source: string; target: string } | null {
  const match = term.match(/^(.+?)(?:=>|->)(.+)$/)
  if (!match) return null
  const source = normalizeAliasSide(match[1])
  const target = normalizeAliasSide(match[2])
  if (!source || !target || source === target) return null
  return { source, target }
}

function normalizeAliasSide(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s@]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bumpConfidence(confidence: ReceiptConfidence): ReceiptConfidence {
  if (confidence === 'LOW') return 'MEDIUM'
  return confidence
}

export function isAllowedLocalAiHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal' ||
    hostname === 'ollama' ||
    hostname === 'local-ai' ||
    hostname === 'localai' ||
    hostname.endsWith('.local')
  )
}
