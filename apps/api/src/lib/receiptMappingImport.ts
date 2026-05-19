import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from './prisma'
import { parseCsvRows, stringifyCsv } from './csv'
import { loadReceiptClassifierConfig, merchantMappingKey, normalizeReceiptLabel, type ReceiptClassifierConfig } from './receiptClassifier'

export const RECEIPT_MAPPING_CSV_HEADERS = [
  'merchantName',
  'merchantKey',
  'originalLabel',
  'normalizedLabel',
  'categoryId',
  'categoryName',
  'subcategoryId',
  'subcategoryName',
  'confidence',
  'termType',
  'term',
  'isActive',
  'notes',
] as const

type ReceiptMappingHeader = typeof RECEIPT_MAPPING_CSV_HEADERS[number]
type ImportStatus = 'create' | 'update' | 'unchanged' | 'invalid' | 'skipped'
type ImportKind = 'mapping' | 'term'
type ImportTermType = 'NOISE_TOKEN' | 'LOW_VALUE_WORD' | 'OCR_ALIAS'

interface CategoryChoice {
  id: string
  name: string
  receiptSubcategories: Array<{ id: string; name: string }>
}

interface ExistingMapping {
  scopeKey: string
  householdId: string | null
  normalizedLabel: string
  merchantKey: string
  categoryId: string
  subcategoryId: string | null
  category: { name: string }
  subcategory: { name: string } | null
  confidence: { toString(): string }
  hitCount: number
}

interface ExistingClassifierTerm {
  scopeKey: string
  termType: ImportTermType
  term: string
  isActive: boolean
  source: string
  hitCount: number
}

export interface ReceiptMappingImportRow {
  rowNumber: number
  merchantName: string
  merchantKey: string
  originalLabel: string
  normalizedLabel: string
  categoryId: string
  categoryName: string
  subcategoryId: string | null
  subcategoryName: string
  confidence: number
  termType: ImportTermType | ''
  term: string
  isActive: boolean
  kind: ImportKind
  notes: string
  status: ImportStatus
  errors: string[]
}

export interface ReceiptMappingImportPreview {
  counts: Record<ImportStatus, number> & { total: number; valid: number }
  rows: ReceiptMappingImportRow[]
}

export async function buildReceiptMappingExportKit(householdId: string) {
  const [categories, mappings, classifierTerms] = await Promise.all([
    loadCategoryChoices(householdId),
    loadExistingMappings(householdId, { includeGlobal: true }),
    loadExistingClassifierTerms(householdId),
  ])

  const categoryCsv = stringifyCsv([
    ['categoryId', 'categoryName', 'subcategoryId', 'subcategoryName'],
    ...categories.flatMap((category) => {
      if (category.receiptSubcategories.length === 0) return [[category.id, category.name, '', '']]
      return category.receiptSubcategories.map((subcategory) => [category.id, category.name, subcategory.id, subcategory.name])
    }),
  ])

  const mappingCsv = stringifyCsv([
    [...RECEIPT_MAPPING_CSV_HEADERS],
    ...mappings.map((mapping) => [
      '',
      mapping.merchantKey,
      mapping.normalizedLabel,
      mapping.normalizedLabel,
      mapping.categoryId,
      mapping.category.name,
      mapping.subcategoryId ?? '',
      mapping.subcategory?.name ?? '',
      mapping.confidence.toString(),
      '',
      '',
      '',
      `${mapping.scopeKey === 'system' ? 'Global' : 'Household'} mapping, ${mapping.hitCount} hits`,
    ]),
  ])

  const templateCsv = stringifyCsv([
    [...RECEIPT_MAPPING_CSV_HEADERS],
    ['Netto', 'netto', 'Organic Milk 1L 12,95', 'organic milk', 'category-id-here', 'Food & Groceries', 'subcategory-id-here', 'Food', '0.95', '', '', '', 'example mapping row'],
    ['', '', '', '', '', '', '', '', '', 'NOISE_TOKEN', 'varenr', 'true', 'example classifier term row'],
    ['', '', '', '', '', '', '', '', '', 'OCR_ALIAS', 'totlet=>toilet', 'true', 'example OCR correction row'],
  ])

  const classifierTermCsv = stringifyCsv([
    ['termType', 'term', 'isActive', 'source', 'hitCount', 'scope'],
    ...classifierTerms.map((term) => [term.termType, term.term, term.isActive ? 'true' : 'false', term.source, term.hitCount, term.scopeKey === 'system' ? 'system' : 'household']),
  ])

  const prompt = [
    'You are helping prepare receipt line category mappings for Budgeteer.',
    'Return CSV only. Do not wrap it in markdown. Use exactly this header:',
    RECEIPT_MAPPING_CSV_HEADERS.join(','),
    '',
    'Rules:',
    '- Prefer categoryId and subcategoryId values from the category catalog below.',
    '- If IDs are unavailable, categoryName and subcategoryName may be used as a portable fallback.',
    '- categoryId or categoryName is required. subcategoryId/subcategoryName may be blank when no safe subcategory exists.',
    '- To add or change classifier terms, use termType and term. Allowed termType values are NOISE_TOKEN, LOW_VALUE_WORD, and OCR_ALIAS.',
    '- Classifier term rows should leave categoryId, subcategoryId, originalLabel, and normalizedLabel blank.',
    '- Use NOISE_TOKEN for OCR/package noise such as units, package sizes, line codes, and receipt metadata words.',
    '- Use LOW_VALUE_WORD for lines that should not become purchases, such as totals, payment methods, tax, and change.',
    '- Use OCR_ALIAS for common OCR spelling corrections in source=>target format, for example totlet=>toilet.',
    '- isActive may be true or false for classifier term rows.',
    '- Include categoryName and subcategoryName for readability, but IDs are authoritative.',
    '- Normalize labels by removing prices, quantities, package sizes, receipt codes, and punctuation.',
    '- merchantKey should be a lowercase normalized merchant name; leave blank if unknown.',
    '- confidence must be between 0 and 1. Use 0.9+ only for obvious matches.',
    '- Do not invent categories or subcategories.',
    '',
    'Category catalog CSV:',
    categoryCsv,
    '',
    'Existing mappings CSV:',
    mappingCsv,
    '',
    'Existing classifier terms CSV:',
    classifierTermCsv,
    '',
    'Now read the receipt lines I provide and return mapping rows for reusable product labels.',
  ].join('\n')

  return { headers: RECEIPT_MAPPING_CSV_HEADERS, prompt, templateCsv, categoryCsv, existingMappingsCsv: mappingCsv, classifierTermCsv }
}

export async function previewReceiptMappingImport(householdId: string, csvText: string): Promise<ReceiptMappingImportPreview> {
  const [categories, mappings, classifierTerms, classifierConfig] = await Promise.all([
    loadCategoryChoices(householdId),
    loadExistingMappings(householdId),
    loadExistingClassifierTerms(householdId),
    loadReceiptClassifierConfig(householdId),
  ])
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const categoryByName = new Map(categories.map((category) => [normalizeNameKey(category.name), category]))
  const subcategoryById = new Map(categories.flatMap((category) =>
    category.receiptSubcategories.map((subcategory) => [subcategory.id, { ...subcategory, categoryId: category.id }]),
  ))
  const existingByKey = new Map(mappings.map((mapping) => [mappingKey(mapping.normalizedLabel, mapping.merchantKey), mapping]))
  const existingTermByKey = new Map(classifierTerms
    .filter((term) => term.scopeKey === householdId)
    .map((term) => [termKey(term.termType, term.term), term]))
  const seen = new Set<string>()
  const seenTerms = new Set<string>()

  const records = parseCsvRecords(csvText)
  const rows = records.map((record): ReceiptMappingImportRow => {
    const termType = normalizeTermType(field(record, 'termType'))
    const term = normalizeClassifierImportTerm(field(record, 'term'), termType)
    const isTermRow = Boolean(termType || term)
    const merchantName = field(record, 'merchantName')
    const originalLabel = field(record, 'originalLabel')
    const merchantKey = field(record, 'merchantKey') || merchantMappingKey(merchantName, classifierConfig)
    const normalizedLabel = field(record, 'normalizedLabel') || normalizeReceiptLabel(originalLabel, classifierConfig)
    let categoryId = field(record, 'categoryId')
    let subcategoryId = field(record, 'subcategoryId') || null
    const confidence = parseConfidence(field(record, 'confidence'))
    const isActive = parseBoolean(field(record, 'isActive'), true)
    const errors: string[] = []

    if (isTermRow) {
      if (!termType) errors.push('termType must be NOISE_TOKEN, LOW_VALUE_WORD, or OCR_ALIAS')
      if (!term) errors.push('term is required')
      if (termType === 'OCR_ALIAS' && !parseOcrAliasImportTerm(term)) errors.push('OCR_ALIAS term must use source=>target format')
      if (categoryId || subcategoryId || originalLabel || normalizedLabel) errors.push('classifier term rows must not include mapping labels or category IDs')
    } else {
      if (!originalLabel && !normalizedLabel) errors.push('originalLabel or normalizedLabel is required')
      if (!normalizedLabel) errors.push('normalizedLabel could not be derived')
      if (!categoryId && !field(record, 'categoryName')) errors.push('categoryId or categoryName is required')
    }

    let category = categoryId ? categoryById.get(categoryId) : null
    if (!isTermRow && categoryId && !category) errors.push('Unknown categoryId')
    if (!isTermRow && !categoryId && field(record, 'categoryName')) {
      category = categoryByName.get(normalizeNameKey(field(record, 'categoryName'))) ?? null
      if (category) categoryId = category.id
      else errors.push('Unknown categoryName')
    }

    let subcategoryName = field(record, 'subcategoryName')
    if (!isTermRow && !subcategoryId && subcategoryName && category) {
      const subcategory = category.receiptSubcategories.find((candidate) => normalizeNameKey(candidate.name) === normalizeNameKey(subcategoryName))
      if (subcategory) {
        subcategoryId = subcategory.id
        subcategoryName = subcategory.name
      } else {
        errors.push('Unknown subcategoryName')
      }
    }

    if (!isTermRow && subcategoryId) {
      const subcategory = subcategoryById.get(subcategoryId)
      if (!subcategory) {
        errors.push('Unknown subcategoryId')
      } else if (subcategory.categoryId !== categoryId) {
        errors.push('subcategoryId does not belong to categoryId')
      } else {
        subcategoryName = subcategory.name
      }
    }

    if (!isTermRow && !Number.isFinite(confidence)) errors.push('confidence must be a number between 0 and 1')
    const key = mappingKey(normalizedLabel, merchantKey)
    const classifierTermKey = termType && term ? termKey(termType, term) : ''
    if (isTermRow) {
      if (classifierTermKey && seenTerms.has(classifierTermKey)) errors.push('Duplicate classifier term row for termType and term')
      if (classifierTermKey) seenTerms.add(classifierTermKey)
    } else {
      if (seen.has(key)) errors.push('Duplicate mapping row for merchantKey and normalizedLabel')
      seen.add(key)
    }

    const existing = existingByKey.get(key)
    const existingTerm = classifierTermKey ? existingTermByKey.get(classifierTermKey) : null
    let status: ImportStatus = 'create'
    if (errors.length > 0) {
      status = 'invalid'
    } else if (isTermRow && existingTerm && existingTerm.isActive === isActive) {
      status = 'unchanged'
    } else if (isTermRow && existingTerm) {
      status = 'update'
    } else if (!isTermRow && confidence < 0.5) {
      status = 'skipped'
    } else if (!isTermRow && existing && existing.categoryId === categoryId && (existing.subcategoryId ?? null) === subcategoryId) {
      status = 'unchanged'
    } else if (!isTermRow && existing) {
      status = 'update'
    }

    return {
      rowNumber: record.rowNumber,
      merchantName,
      merchantKey,
      originalLabel,
      normalizedLabel,
      categoryId,
      categoryName: category?.name ?? field(record, 'categoryName'),
      subcategoryId,
      subcategoryName,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      termType: termType ?? '',
      term,
      isActive,
      kind: isTermRow ? 'term' : 'mapping',
      notes: field(record, 'notes'),
      status,
      errors,
    }
  })

  return summarizeRows(rows)
}

export async function confirmReceiptMappingImport(householdId: string, csvText: string): Promise<ReceiptMappingImportPreview> {
  const preview = await previewReceiptMappingImport(householdId, csvText)
  const writableRows = preview.rows.filter((row) => row.kind === 'mapping' && (row.status === 'create' || row.status === 'update'))
  const writableTermRows = preview.rows.filter((row) => row.kind === 'term' && (row.status === 'create' || row.status === 'update'))

  for (const row of writableRows) {
    await prisma.receiptCategoryMapping.upsert({
      where: {
        scopeKey_normalizedLabel_merchantKey: {
          scopeKey: householdId,
          normalizedLabel: row.normalizedLabel,
          merchantKey: row.merchantKey,
        },
      },
      create: {
        scopeKey: householdId,
        householdId,
        normalizedLabel: row.normalizedLabel,
        merchantKey: row.merchantKey,
        categoryId: row.categoryId,
        subcategoryId: row.subcategoryId,
        confidence: new Decimal(row.confidence),
      },
      update: {
        categoryId: row.categoryId,
        subcategoryId: row.subcategoryId,
        confidence: new Decimal(row.confidence),
        lastUsedAt: new Date(),
      },
    })
  }

  const delegate = (prisma as any).receiptClassifierTerm
  if (delegate?.upsert) {
    for (const row of writableTermRows) {
      await delegate.upsert({
        where: {
          scopeKey_termType_term: {
            scopeKey: householdId,
            termType: row.termType,
            term: row.term,
          },
        },
        create: {
          scopeKey: householdId,
          householdId,
          termType: row.termType,
          term: row.term,
          isActive: row.isActive,
          source: 'CSV_IMPORT',
          hitCount: 0,
        },
        update: {
          isActive: row.isActive,
          source: 'CSV_IMPORT',
        },
      })
    }
  }

  return preview
}

async function loadCategoryChoices(householdId: string): Promise<CategoryChoice[]> {
  return prisma.category.findMany({
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
    orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
  })
}

async function loadExistingMappings(householdId: string, options: { includeGlobal?: boolean } = {}): Promise<ExistingMapping[]> {
  return prisma.receiptCategoryMapping.findMany({
    where: options.includeGlobal
      ? { OR: [{ scopeKey: 'system' }, { scopeKey: householdId }] }
      : { scopeKey: householdId },
    select: {
      scopeKey: true,
      householdId: true,
      normalizedLabel: true,
      merchantKey: true,
      categoryId: true,
      subcategoryId: true,
      confidence: true,
      hitCount: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
    },
    orderBy: [{ hitCount: 'desc' }, { lastUsedAt: 'desc' }],
  })
}

async function loadExistingClassifierTerms(householdId: string): Promise<ExistingClassifierTerm[]> {
  const delegate = (prisma as any).receiptClassifierTerm
  if (!delegate?.findMany) return []
  return delegate.findMany({
    where: {
      OR: [
        { scopeKey: 'system' },
        { scopeKey: householdId },
      ],
    },
    select: {
      scopeKey: true,
      termType: true,
      term: true,
      isActive: true,
      source: true,
      hitCount: true,
    },
    orderBy: [{ termType: 'asc' }, { term: 'asc' }],
  }) as Promise<ExistingClassifierTerm[]>
}

function parseCsvRecords(csvText: string): Array<Record<ReceiptMappingHeader, string> & { rowNumber: number }> {
  const table = parseCsvRows(csvText)
  if (table.length === 0) return []
  const header = table[0].map((cell) => cell.trim())
  const indexes = new Map(header.map((name, index) => [name, index]))
  const missing = RECEIPT_MAPPING_CSV_HEADERS.filter((name) => !indexes.has(name))
  if (missing.length > 0) throw new Error(`Missing CSV columns: ${missing.join(', ')}`)

  return table.slice(1)
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim()))
    .map(({ cells, rowNumber }) => {
      const record = { rowNumber } as Record<ReceiptMappingHeader, string> & { rowNumber: number }
      for (const name of RECEIPT_MAPPING_CSV_HEADERS) record[name] = cells[indexes.get(name)!]?.trim() ?? ''
      return record
    })
}

function field(record: Record<ReceiptMappingHeader, string>, name: ReceiptMappingHeader): string {
  return record[name]?.trim() ?? ''
}

function parseConfidence(value: string): number {
  if (!value) return 1
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed)) return Number.NaN
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed
  return normalized >= 0 && normalized <= 1 ? normalized : Number.NaN
}

function mappingKey(normalizedLabel: string, merchantKey: string): string {
  return `${merchantKey}\u0000${normalizedLabel}`
}

function termKey(termType: ImportTermType, term: string): string {
  return `${termType}\u0000${term}`
}

function normalizeTermType(value: string): ImportTermType | null {
  const normalized = value.trim().toUpperCase()
  return normalized === 'NOISE_TOKEN' || normalized === 'LOW_VALUE_WORD' || normalized === 'OCR_ALIAS' ? normalized : null
}

function normalizeClassifierImportTerm(value: string, termType?: ImportTermType | null): string {
  if (termType === 'OCR_ALIAS') {
    const alias = parseOcrAliasImportTerm(value)
    return alias ? `${alias.source}=>${alias.target}` : value.trim().toLowerCase()
  }
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function parseOcrAliasImportTerm(value: string): { source: string; target: string } | null {
  const match = value.trim().toLowerCase().match(/^(.+?)(?:=>|->)(.+)$/)
  if (!match) return null
  const source = normalizeOcrAliasSide(match[1])
  const target = normalizeOcrAliasSide(match[2])
  if (!source || !target || source === target) return null
  return { source, target }
}

function normalizeOcrAliasSide(value: string): string {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s@]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'y', 'active'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', 'inactive'].includes(normalized)) return false
  return fallback
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function summarizeRows(rows: ReceiptMappingImportRow[]): ReceiptMappingImportPreview {
  const counts = {
    total: rows.length,
    valid: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    invalid: 0,
    skipped: 0,
  }
  for (const row of rows) {
    counts[row.status] += 1
    if (row.status === 'create' || row.status === 'update' || row.status === 'unchanged') counts.valid += 1
  }
  return { counts, rows }
}
