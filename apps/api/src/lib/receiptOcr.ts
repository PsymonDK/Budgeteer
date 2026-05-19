import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])

export interface ReceiptOcrResult {
  rawText: string
  notes: string[]
}

export async function extractReceiptOcrText(args: {
  filePath: string
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'
}): Promise<ReceiptOcrResult> {
  if (!SUPPORTED_MIME_TYPES.has(args.mimeType)) {
    return { rawText: '', notes: ['Receipt OCR skipped because the file type is not supported.'] }
  }

  try {
    const rawText = args.mimeType === 'application/pdf'
      ? await extractPdfText(args.filePath)
      : await extractImageText(args.filePath)

    const normalizedText = normalizeOcrText(rawText)
    return {
      rawText: normalizedText,
      notes: normalizedText ? [] : ['Server-side OCR did not detect readable receipt text.'],
    }
  } catch (err) {
    return {
      rawText: '',
      notes: [buildOcrErrorNote(err)],
    }
  }
}

export function normalizeOcrText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractImageText(filePath: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'budgeteer-receipt-image-'))
  const candidates: string[] = []

  try {
    const preprocessedPath = await preprocessReceiptImage(filePath, tempDir)
    if (preprocessedPath) candidates.push(preprocessedPath)
    candidates.push(filePath)

    return await runBestTesseract(candidates)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  const maxPages = Math.max(1, Number(process.env.RECEIPT_OCR_MAX_PDF_PAGES ?? 3))
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'budgeteer-receipt-ocr-'))
  const outputPrefix = path.join(tempDir, 'page')

  try {
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      process.env.RECEIPT_OCR_PDF_DPI ?? '200',
      '-f',
      '1',
      '-l',
      String(maxPages),
      filePath,
      outputPrefix,
    ])

    const files = (await fs.readdir(tempDir))
      .filter((file) => file.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

    const pages = await Promise.all(files.map((file) => runBestTesseract([path.join(tempDir, file)])))
    return pages.join('\n\n')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function preprocessReceiptImage(filePath: string, tempDir: string): Promise<string | null> {
  if (process.env.RECEIPT_OCR_PREPROCESS === 'false') return null

  const scriptPath = await findPreprocessScript()
  if (!scriptPath) return null

  const outputPath = path.join(tempDir, 'receipt-preprocessed.png')
  try {
    await execFileAsync(process.env.RECEIPT_OCR_PYTHON ?? 'python3', [
      scriptPath,
      filePath,
      outputPath,
    ], { maxBuffer: 1024 * 1024, timeout: 30_000 })
    return outputPath
  } catch {
    return null
  }
}

async function findPreprocessScript(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), 'apps/api/scripts/preprocess_receipt_image.py'),
    path.resolve(process.cwd(), 'scripts/preprocess_receipt_image.py'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next runtime layout.
    }
  }

  return null
}

async function runBestTesseract(filePaths: string[]): Promise<string> {
  const configuredPsm = process.env.RECEIPT_OCR_PSM
  const languages = getOcrLanguageCandidates()
  let bestText = ''
  let bestScore = Number.NEGATIVE_INFINITY
  let firstError: unknown = null

  for (const [index, filePath] of filePaths.entries()) {
    const psms = unique([
      configuredPsm,
      ...(index === 0 && filePaths.length > 1 ? ['6', '4'] : ['1', '6', '4']),
    ].filter((psm): psm is string => Boolean(psm)))

    for (const lang of languages) {
      for (const psm of psms) {
        try {
          const text = await runTesseract(filePath, psm, lang)
          const score = scoreOcrText(text)
          if (score > bestScore) {
            bestScore = score
            bestText = text
          }
          if (score >= 1_000) return text
        } catch (err) {
          firstError ??= err
        }
      }
    }

    if (index === 0 && filePaths.length > 1 && bestScore >= 120) return bestText
  }

  if (bestText) return bestText
  throw firstError ?? new Error('Tesseract did not return OCR text.')
}

function getOcrLanguageCandidates(): string[] {
  if (process.env.RECEIPT_OCR_LANG) return [process.env.RECEIPT_OCR_LANG]
  return ['dan+eng', 'eng']
}

async function runTesseract(filePath: string, psm: string, lang: string): Promise<string> {
  const timeout = Math.max(1, Number(process.env.RECEIPT_OCR_TIMEOUT_MS ?? 45_000))
  const { stdout } = await execFileAsync('tesseract', [
    filePath,
    'stdout',
    '-l',
    lang,
    '--psm',
    psm,
  ], { maxBuffer: 8 * 1024 * 1024, timeout })

  return stdout
}

export function scoreOcrText(value: string): number {
  const text = normalizeOcrText(value)
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const amountPattern = /[-+]?\d{1,6}(?:[.,]\d{2})-?\s*(?:DKK|EUR|USD|GBP|SEK|NOK)?\s*$/i
  const amountLines = lines.filter((line) => amountPattern.test(line)).length
  const itemAmountLines = lines.filter((line) => amountPattern.test(line) && /[A-Za-zÆØÅæøå]/.test(line.replace(amountPattern, ''))).length
  const keywordHits = (text.match(/\b(?:total|sum|moms|vat|dankort|receipt|kvittering|netto|fakta|rema|føtex|bilka|lidl)\b/gi) ?? []).length
  const compactText = text.replace(/\s/g, '')
  const readableChars = compactText.match(/[A-Za-zÆØÅæøå0-9.,:;/%+()&'"_\-@]/g)?.length ?? 0
  const noisyChars = Math.max(0, compactText.length - readableChars)

  return (itemAmountLines * 25) + (amountLines * 8) + (keywordHits * 10) + Math.min(lines.length, 80) - (noisyChars * 2)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function buildOcrErrorNote(err: unknown): string {
  if (err instanceof Error) {
    if ('code' in err && err.code === 'ENOENT') {
      return 'Server-side OCR is unavailable because required local OCR binaries are not installed.'
    }
    return `Server-side OCR failed: ${err.message}`
  }
  return 'Server-side OCR failed for this receipt.'
}
