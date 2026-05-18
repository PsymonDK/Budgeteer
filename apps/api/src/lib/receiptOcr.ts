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
  return runTesseract(filePath)
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

    const pages = await Promise.all(files.map((file) => runTesseract(path.join(tempDir, file))))
    return pages.join('\n\n')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function runTesseract(filePath: string): Promise<string> {
  const lang = process.env.RECEIPT_OCR_LANG ?? 'eng'
  const psm = process.env.RECEIPT_OCR_PSM ?? '6'
  const { stdout } = await execFileAsync('tesseract', [
    filePath,
    'stdout',
    '-l',
    lang,
    '--psm',
    psm,
  ], { maxBuffer: 8 * 1024 * 1024 })

  return stdout
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
