import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import type { ParsedReceipt, ParsedReceiptLineItem, ReceiptConfidence } from './receiptParser'

interface CategoryCandidate {
  id: string
  name: string
  receiptSubcategories: Array<{ id: string; name: string }>
}

interface MappingCandidate {
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

const LOW_VALUE_WORDS = new Set(['total', 'subtotal', 'sum', 'change', 'cash', 'card', 'visa', 'mastercard', 'dankort', 'tax', 'vat', 'moms'])
const FUZZY_MIN_LABEL_SIMILARITY = 0.72
const FUZZY_MIN_SCORE = 0.78

export function normalizeReceiptLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:x|stk|pcs?|kg|g|l|ml)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function merchantMappingKey(merchantName?: string | null): string {
  return normalizeReceiptLabel(merchantName ?? '')
}

export async function applyCategorySuggestions(receipt: ParsedReceipt, householdId: string): Promise<ParsedReceipt> {
  if (receipt.lineItems.length === 0) return receipt

  const [categories, rawMappings] = await Promise.all([
    prisma.category.findMany({
      where: {
        categoryType: 'EXPENSE',
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
      },
      select: {
        id: true,
        name: true,
        receiptSubcategories: {
          where: { isActive: true, OR: [{ isSystemWide: true }, { householdId }] },
          select: { id: true, name: true },
          orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
        },
      },
    }),
    prisma.receiptCategoryMapping.findMany({
      where: { householdId },
      select: { categoryId: true, subcategoryId: true, normalizedLabel: true, merchantKey: true, hitCount: true, lastUsedAt: true },
      orderBy: [{ hitCount: 'desc' }, { lastUsedAt: 'desc' }],
      take: 1000,
    }),
  ])

  const mappings = rawMappings.filter((mapping) => isValidSuggestion(mapping, categories))
  const merchantKey = merchantMappingKey(receipt.merchantName)
  const firstPassItems = receipt.lineItems.map((item) => classifyWithoutAi(item, receipt.merchantName, merchantKey, categories, mappings))
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
  items: Array<{ normalizedLabel: string; categoryId?: string | null; subcategoryId?: string | null; isIgnored?: boolean }>
}) {
  const merchantKey = merchantMappingKey(args.merchantName)
  const usable = args.items.filter((item) => item.categoryId && !item.isIgnored && item.normalizedLabel)

  for (const item of usable) {
    await prisma.receiptCategoryMapping.upsert({
      where: {
        householdId_normalizedLabel_merchantKey: {
          householdId: args.householdId,
          normalizedLabel: item.normalizedLabel,
          merchantKey,
        },
      },
      create: {
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
}

function classifyWithoutAi(
  item: ParsedReceiptLineItem,
  merchantName: string | null | undefined,
  merchantKey: string,
  categories: CategoryCandidate[],
  mappings: MappingCandidate[],
): ParsedReceiptLineItem {
  const exactSameMerchant = mappings.find((mapping) =>
    mapping.normalizedLabel === item.normalizedLabel && mapping.merchantKey === merchantKey,
  )
  if (exactSameMerchant) {
    return { ...item, ...mappingToSuggestion(exactSameMerchant), confidence: bumpConfidence(item.confidence) }
  }

  const exactAnyMerchant = mappings.find((mapping) => mapping.normalizedLabel === item.normalizedLabel)
  if (exactAnyMerchant) {
    return { ...item, ...mappingToSuggestion(exactAnyMerchant), confidence: bumpConfidence(item.confidence) }
  }

  const fuzzy = findFuzzyMapping(item.normalizedLabel, merchantKey, mappings)
  if (fuzzy) {
    return { ...item, ...mappingToSuggestion(fuzzy.mapping), confidence: fuzzy.confidence }
  }

  const ruleSuggestion = suggestCategory(item.normalizedLabel, merchantName, categories)
  return ruleSuggestion ? { ...item, ...ruleSuggestion, confidence: ruleSuggestion.confidence ?? item.confidence } : item
}

function findFuzzyMapping(label: string, merchantKey: string, mappings: MappingCandidate[]) {
  let best: { mapping: MappingCandidate; labelSimilarity: number; score: number } | null = null
  for (const mapping of mappings) {
    if (mapping.normalizedLabel === label) continue
    const labelSimilarity = normalizedSimilarity(label, mapping.normalizedLabel)
    if (labelSimilarity < FUZZY_MIN_LABEL_SIMILARITY) continue

    const merchantBoost = mapping.merchantKey && mapping.merchantKey === merchantKey ? 0.08 : 0
    const usageBoost = Math.min(Math.log1p(mapping.hitCount) / 80, 0.06)
    const recencyBoost = recencyScore(mapping.lastUsedAt) * 0.04
    const score = labelSimilarity + merchantBoost + usageBoost + recencyBoost
    if (score >= FUZZY_MIN_SCORE && (!best || score > best.score)) {
      best = { mapping, labelSimilarity, score }
    }
  }

  if (!best) return null
  return {
    mapping: best.mapping,
    confidence: best.labelSimilarity >= 0.9 || best.mapping.merchantKey === merchantKey ? 'HIGH' as const : 'MEDIUM' as const,
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
  suggestion: { categoryId: string; subcategoryId?: string | null },
  categories: CategoryCandidate[],
): boolean {
  const category = categories.find((candidate) => candidate.id === suggestion.categoryId)
  if (!category) return false
  if (!suggestion.subcategoryId) return true
  return category.receiptSubcategories.some((subcategory) => subcategory.id === suggestion.subcategoryId)
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
  return (dice * 0.65) + (tokenJaccard * 0.35)
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

function recencyScore(value: Date): number {
  const ageMs = Date.now() - value.getTime()
  if (ageMs <= 0) return 1
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1 - (ageDays / 365))
}

export function suggestCategory(label: string, merchantName: string | null | undefined, categories: CategoryCandidate[]): CategorySuggestion | null {
  const haystack = `${label} ${normalizeReceiptLabel(merchantName ?? '')}`
  const find = (names: string[], subcategoryNames: string[] = []) => {
    const category = categories.find((c) => names.some((name) => c.name.toLowerCase().includes(name)))
    if (!category) return null
    const subcategory = category.receiptSubcategories.find((s) =>
      subcategoryNames.some((name) => s.name.toLowerCase().includes(name)),
    )
    return { categoryId: category.id, subcategoryId: subcategory?.id ?? null, confidence: 'MEDIUM' as const }
  }

  if (/(milk|bread|cheese|egg|fruit|vegetable|grocery|grocer|supermarket|netto|rema|føtex|bilka|lidl|aldi|meny|coop)/i.test(haystack)) {
    if (/(vegetable|carrot|potato|tomato|salad|onion|pepper|broccoli|fruit|apple|banana|orange)/i.test(haystack)) return find(['food', 'grocer'], ['vegetable'])
    if (/(beef|pork|chicken|meat|fish|bacon|sausage)/i.test(haystack)) return find(['food', 'grocer'], ['meat'])
    if (/(candy|sweets|chocolate|snack|chips)/i.test(haystack)) return find(['food', 'grocer'], ['candy'])
    if (/(beer|øl)/i.test(haystack)) return find(['food', 'grocer'], ['beer'])
    if (/(wine|vin)/i.test(haystack)) return find(['food', 'grocer'], ['wine'])
    if (/(alcohol|vodka|rum|gin|whisky|whiskey)/i.test(haystack)) return find(['food', 'grocer'], ['alcohol'])
    if (/(toy|lego|game|doll)/i.test(haystack)) return find(['food', 'grocer'], ['toy'])
    if (/(soap|detergent|cleaner|toilet|kitchen|household|laundry)/i.test(haystack)) return find(['food', 'grocer'], ['household'])
    return find(['food', 'grocer'], ['food'])
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
  if ([...LOW_VALUE_WORDS].some((word) => label.includes(word))) return null
  return null
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
