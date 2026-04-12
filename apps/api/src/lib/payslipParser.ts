/**
 * AI-assisted payslip parser using Claude API.
 *
 * This is an OPT-IN feature. Payslips contain personal financial data and must
 * never be sent to external services without explicit user consent.
 *
 * Only called when:
 *   1. ANTHROPIC_API_KEY is configured
 *   2. The user has confirmed they consent to sending data externally
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { PayslipLine } from './taxCalcDK'

export interface PayslipExtraction {
  period: { year: number; month: number }
  employerName: string
  grossSalary: number
  netPay: number
  currency: string
  lines: PayslipLine[]
  pensionEmployerMonthly?: number
  reimbursements?: { label: string; amount: number }[]
  confidence: 'high' | 'medium' | 'low'
  notes?: string[]
}

const PayslipLineSchema = z.object({
  label: z.string(),
  amount: z.number().nonnegative(),
  type: z.enum(['benefit_in_kind', 'pre_am', 'am_bidrag', 'a_skat', 'post_tax']),
  sankeyGroup: z
    .enum(['brutto_benefits', 'am_bidrag', 'a_skat', 'pension_employee', 'atp', 'other_deductions'])
    .optional(),
  isCalculated: z.literal(false),
})

const ReimbursementSchema = z.object({
  label: z.string(),
  amount: z.number(),
})

const PayslipExtractionSchema = z.object({
  period: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }),
  employerName: z.string(),
  grossSalary: z.number().positive(),
  netPay: z.number().positive(),
  currency: z.string().default('DKK'),
  lines: z.array(PayslipLineSchema),
  pensionEmployerMonthly: z.number().nonnegative().optional(),
  reimbursements: z.array(ReimbursementSchema).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.array(z.string()).optional(),
})

const EXTRACTION_PROMPT = `You are a Danish payroll data extractor. Extract structured data from the payslip and return ONLY valid JSON matching the schema below. No prose, no markdown, no explanation.

## Extraction rules

**Period**: Extract year and month from "Lønperiode", "Pay period", or similar header.

**Employer name**: Extract from company name in the document header.

**grossSalary**: Sum of all positive A-income items that form the employee's monthly salary:
- Include: Månedsløn, Gage, Fast tillæg, AIC tillæg, Personligt tillæg, Gageregulering, Fritvalg (udbetaling), St. Bededagskompensation, Ej pensionsg. tillæg, Kompensation ADSL
- Exclude: B-indkomst / "Employers Matched Contribution", reimbursements (km-penge, rejseafregning), holiday pay (feriepenge/ferietillæg sections), benefits in kind value lines (Fri telefon, Samsung phones) — these are taxes but not cash gross

**netPay**: The "Overført til konto", "Nettoløn", or "Net pay" amount. This is what lands in the employee's bank account from regular salary (NOT feriepenge payout).

**lines**: Each deduction with a type:
- "benefit_in_kind": Taxable benefit values shown as positive (Fri telefon / Fritelefon value, Mobil/internet value). These reduce the AM base and affect gross for tax.
- "pre_am": Deductions that reduce AM-indkomst — employee pension %, ATP, health insurance brutto (Sundhedssikring brutto), brutto salary sacrifice items (phone/equipment deducted from gross, i.e. negative Samsung/device lines)
- "am_bidrag": AM-bidrag / Arbejdsmarkedsbidrag (8%)
- "a_skat": A-skat (all income tax combined)
- "post_tax": Post-tax deductions — health insurance netto, kantine, canteen, personaleforening, social club, fast kantinetræk

**sankeyGroup** for each line:
- benefit_in_kind → "brutto_benefits"
- pre_am pension employee → "pension_employee"
- pre_am ATP → "atp"
- pre_am other (brutto items, health insurance brutto) → "brutto_benefits" if salary sacrifice, else "other_deductions"
- am_bidrag → "am_bidrag"
- a_skat → "a_skat"
- post_tax → "other_deductions"

**pensionEmployerMonthly**: Employer pension contribution (firmaandel / firma andel). This is an employer cost, NOT deducted from net. Omit if not present.

**reimbursements**: km-penge, rejseafregning — informational only, not income or deductions.

**Exclude entirely**: B-indkomst / Employers Matched Contribution, feriepenge section (holiday pay payout — separate event), year-to-date totals.

**confidence**: "high" if all key figures are unambiguous, "medium" if some items were uncertain, "low" if document was unclear.

**notes**: List any items you were uncertain about or unusual elements found.

**isCalculated**: Always false (user will review).

## JSON schema
{
  "period": { "year": number, "month": number },
  "employerName": string,
  "grossSalary": number,
  "netPay": number,
  "currency": string,
  "lines": [{ "label": string, "amount": number, "type": "benefit_in_kind"|"pre_am"|"am_bidrag"|"a_skat"|"post_tax", "sankeyGroup": string, "isCalculated": false }],
  "pensionEmployerMonthly": number | undefined,
  "reimbursements": [{ "label": string, "amount": number }] | undefined,
  "confidence": "high"|"medium"|"low",
  "notes": string[] | undefined
}`

export async function parsePayslipWithAI(input: {
  fileBase64?: string
  mimeType?: 'application/pdf' | 'image/png' | 'image/jpeg'
  rawText?: string
}): Promise<PayslipExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const client = new Anthropic({ apiKey })

  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
    | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }

  const content: ContentBlock[] = []

  if (input.fileBase64 && input.mimeType) {
    if (input.mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.fileBase64 },
      })
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mimeType as 'image/png' | 'image/jpeg',
          data: input.fileBase64,
        },
      })
    }
  } else if (input.rawText) {
    content.push({ type: 'text', text: `Payslip text:\n\n${input.rawText}` })
  } else {
    throw new Error('Either fileBase64+mimeType or rawText must be provided')
  }

  content.push({ type: 'text', text: EXTRACTION_PROMPT })

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from AI parser')
  }

  // Strip markdown code fences if present
  const jsonText = textBlock.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error(`AI returned invalid JSON: ${jsonText.slice(0, 200)}`)
  }

  const result = PayslipExtractionSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`AI response failed validation: ${result.error.message}`)
  }

  return result.data as PayslipExtraction
}
