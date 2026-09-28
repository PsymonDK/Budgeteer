import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcIncomeForYearDetailed, getIncomeReferenceDate, JOB_INCOME_INCLUDE } from '../lib/incomeCalc'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'
import { assertHouseholdAccess, getActiveMembership } from '../lib/ownership'
import { toNum } from '../lib/decimal'
import { calcDanishDeductions, PayslipLine } from '../lib/taxCalcDK'
import { buildIncomeHistory, monthStartUTC, pickTaxCardAt, taxCardToInput, yearMonthOfLocalDate } from '../lib/jobIncome'
import { pickDefaultBudgetYear } from '../lib/budgetYearSelection'
import { computeIncomeShares, formatSharePct } from '../lib/incomeShare'

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateJobSchema = z.object({
  name: z.string().min(1).max(200),
  employer: z.string().max(200).optional(),
  country: z.string().min(2).max(10).toUpperCase().default('DK'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const UpdateJobSchema = CreateJobSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const PayslipLineSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().nonnegative(),
  type: z.enum(['benefit_in_kind', 'pre_am', 'am_bidrag', 'a_skat', 'post_tax']),
  sankeyGroup: z.enum(['brutto_benefits', 'am_bidrag', 'a_skat', 'pension_employee', 'atp', 'other_deductions']).optional(),
  isCalculated: z.boolean(),
})

const DeductionFieldsSchema = z.object({
  payslipLines: z.array(PayslipLineSchema).optional(),
  deductionsSource: z.enum(['MANUAL', 'CALCULATED', 'PAYSLIP_IMPORT']).optional(),
})

function validateDeductionNet(
  grossAmount: number,
  netAmount: number,
  d: z.infer<typeof DeductionFieldsSchema>,
  ctx: z.RefinementCtx
) {
  if (!d.payslipLines || d.payslipLines.length === 0) return
  // benefit_in_kind lines add to taxable income but are not cash deductions
  const cashDeductions = d.payslipLines
    .filter((l) => l.type !== 'benefit_in_kind')
    .reduce((s, l) => s + l.amount, 0)
  const expectedNet = grossAmount - cashDeductions
  if (Math.abs(expectedNet - netAmount) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `netAmount (${netAmount}) does not match gross minus deductions (expected ~${expectedNet.toFixed(2)}, tolerance ±1)`,
      path: ['netAmount'],
    })
  }
}

const CreateSalarySchema = z
  .object({
    grossAmount: z.number().positive(),
    netAmount: z.number().positive(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currencyCode: z.string().length(3).toUpperCase().optional(),
  })
  .merge(DeductionFieldsSchema)
  .superRefine((data, ctx) => {
    validateDeductionNet(data.grossAmount, data.netAmount, data, ctx)
  })

const OverrideSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    grossAmount: z.number().positive(),
    netAmount: z.number().positive(),
    note: z.string().max(500).optional(),
  })
  .merge(DeductionFieldsSchema)
  .superRefine((data, ctx) => {
    validateDeductionNet(data.grossAmount, data.netAmount, data, ctx)
  })

const BruttoItemSchema = z.object({
  label: z.string().min(1).max(100),
  monthlyAmount: z.number().nonnegative(),
})

const CreateTaxCardSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  traekprocent: z.number().min(0).max(100),
  personfradragMonthly: z.number().nonnegative(),
  municipality: z.string().max(100).optional(),
  pensionEmployeePct: z.number().min(0).max(100).optional(),
  pensionEmployerPct: z.number().min(0).max(100).optional(),
  atpAmount: z.number().nonnegative().optional(),
  bruttoItems: z.array(BruttoItemSchema).optional(),
})

const UpdateTaxCardSchema = CreateTaxCardSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const CreateBonusSchema = z.object({
  label: z.string().min(1).max(200),
  grossAmount: z.number().positive(),
  netAmount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeInBudget: z.boolean(),
  budgetMode: z.enum(['ONE_OFF', 'SPREAD_ANNUALLY']).optional(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
})

const UpdateBonusSchema = CreateBonusSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const AllocationSchema = z.object({
  allocationPct: z.number().min(0).max(100),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The budget year income allocations are edited in: the household's earliest
 * ACTIVE year, else its earliest FUTURE year. Returns null when the household
 * has neither — allocating income never creates a budget year.
 */
async function findDefaultBudgetYear(householdId: string) {
  const years = await prisma.budgetYear.findMany({
    where: { householdId, status: { in: ['ACTIVE', 'FUTURE'] } },
  })
  return pickDefaultBudgetYear(years)
}

const NO_BUDGET_YEAR_ERROR = {
  error: 'This household has no active or future budget year. Create a budget year before allocating income.',
  code: 'NO_BUDGET_YEAR',
}

async function assertJobOwnership(jobId: string, requesterId: string, requesterRole: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { user: true } })
  if (!job) return null
  if (job.userId === requesterId) return job
  // Bookkeeper or admin: may only access proxy users' jobs
  if (['SYSTEM_ADMIN', 'BOOKKEEPER'].includes(requesterRole) && job.user.isProxy) return job
  return null
}

/**
 * Resolve deduction data for a salary record or monthly override.
 *
 * Priority:
 *   1. Explicit payslipLines in request → store verbatim, source = MANUAL
 *   2. Job is DK + a tax card effective at atDate → auto-calculate, source = CALCULATED
 *   3. Fallback → all null (legacy behaviour, no deduction data stored)
 *
 * atDate is the date the pay applies to — the salary record's effectiveFrom or
 * the first day of the override's month — never today's date, so a record
 * dated in another tax year uses that year's tax card.
 */
async function resolveDeductions(
  jobId: string,
  jobCountry: string,
  gross: number,
  atDate: Date,
  requestPayslipLines?: PayslipLine[]
): Promise<{
  payslipLines: PayslipLine[] | null
  pensionEmployerMonthly: Decimal | null
  deductionsSource: string | null
  netAmount: Decimal | null  // null means "use request netAmount as-is"
}> {
  if (requestPayslipLines && requestPayslipLines.length > 0) {
    // MANUAL: user submitted explicit payslip lines
    const cashDeductions = requestPayslipLines
      .filter((l) => l.type !== 'benefit_in_kind')
      .reduce((s, l) => s + l.amount, 0)
    return {
      payslipLines: requestPayslipLines,
      pensionEmployerMonthly: null,
      deductionsSource: 'MANUAL',
      netAmount: new Decimal(Math.round((gross - cashDeductions) * 100) / 100),
    }
  }

  if (jobCountry === 'DK') {
    const taxCards = await prisma.taxCardSettings.findMany({ where: { jobId } })
    const taxCard = pickTaxCardAt(taxCards, atDate)
    if (taxCard) {
      const calc = calcDanishDeductions(gross, taxCardToInput(taxCard))
      return {
        payslipLines: calc.lines,
        pensionEmployerMonthly: calc.pensionEmployer > 0 ? new Decimal(calc.pensionEmployer) : null,
        deductionsSource: 'CALCULATED',
        netAmount: new Decimal(calc.net),
      }
    }
  }

  // Fallback: no deduction data
  return {
    payslipLines: null,
    pensionEmployerMonthly: null,
    deductionsSource: null,
    netAmount: null,
  }
}

/**
 * Recalculate payslip deductions for all non-MANUAL salary records and
 * monthly overrides belonging to a job.  Called after a tax card is
 * created or updated so stored net pay stays in sync.
 *
 * Records with deductionsSource = 'MANUAL' are never touched.
 * For each record the applicable tax card is the most recent one whose
 * effectiveFrom ≤ the record date.  Records with no applicable card are
 * skipped (deductionsSource stays null until a card is added for that period).
 */
async function recalculateSalaryDeductions(jobId: string, jobCountry: string): Promise<void> {
  if (jobCountry !== 'DK') return

  const taxCards = await prisma.taxCardSettings.findMany({ where: { jobId } })
  if (taxCards.length === 0) return

  const salaryRecords = await prisma.salaryRecord.findMany({
    where: { jobId, NOT: { deductionsSource: 'MANUAL' } },
  })
  for (const record of salaryRecords) {
    const card = pickTaxCardAt(taxCards, record.effectiveFrom)
    if (!card) continue
    const calc = calcDanishDeductions(toNum(record.grossAmount), taxCardToInput(card))
    await prisma.salaryRecord.update({
      where: { id: record.id },
      data: {
        netAmount: new Decimal(calc.net),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payslipLines: calc.lines as any,
        pensionEmployerMonthly: calc.pensionEmployer > 0 ? new Decimal(calc.pensionEmployer) : null,
        deductionsSource: 'CALCULATED',
      },
    })
  }

  const overrides = await prisma.monthlyIncomeOverride.findMany({
    where: { jobId, NOT: { deductionsSource: 'MANUAL' } },
  })
  for (const override of overrides) {
    // UTC month start: comparable with effectiveFrom stored as UTC midnight
    const card = pickTaxCardAt(taxCards, monthStartUTC(override.year, override.month))
    if (!card) continue
    const calc = calcDanishDeductions(toNum(override.grossAmount), taxCardToInput(card))
    await prisma.monthlyIncomeOverride.update({
      where: { id: override.id },
      data: {
        netAmount: new Decimal(calc.net),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payslipLines: calc.lines as any,
        pensionEmployerMonthly: calc.pensionEmployer > 0 ? new Decimal(calc.pensionEmployer) : null,
        deductionsSource: 'CALCULATED',
      },
    })
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function jobRoutes(fastify: FastifyInstance) {

  // ── Jobs CRUD ────────────────────────────────────────────────────────────────

  // GET /users/:id/jobs — list all jobs with latest salary + active bonus count
  fastify.get('/users/:id/jobs', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN' && userId !== targetUserId) {
      if (role === 'BOOKKEEPER') {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } })
        if (!target?.isProxy) return reply.status(403).send({ error: 'Forbidden' })
      } else {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    const jobs = await prisma.job.findMany({
      where: { userId: targetUserId },
      include: {
        salaryRecords: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        bonuses: { where: { paymentDate: { gte: new Date() } }, select: { id: true } },
        allocations: {
          include: {
            budgetYear: { select: { id: true, year: true, status: true, household: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    })

    // The budget year each household's allocations are edited in (what
    // PUT/DELETE /income/:id/allocations/:householdId target).
    const householdIds = [...new Set(jobs.flatMap((j) => j.allocations.map((a) => a.budgetYear.household.id)))]
    const liveYears = householdIds.length > 0
      ? await prisma.budgetYear.findMany({
          where: { householdId: { in: householdIds }, status: { in: ['ACTIVE', 'FUTURE'] } },
          select: { id: true, householdId: true, year: true, status: true },
        })
      : []
    const defaultYearIds = new Set(
      householdIds
        .map((hid) => pickDefaultBudgetYear(liveYears.filter((y) => y.householdId === hid))?.id)
        .filter((id): id is string => id !== undefined)
    )

    const result = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      employer: j.employer,
      country: j.country,
      startDate: j.startDate,
      endDate: j.endDate,
      isActive: j.endDate === null || j.endDate > new Date(),
      latestSalary: j.salaryRecords[0] ?? null,
      upcomingBonusCount: j.bonuses.length,
      // Default-year allocations first, then newest year first, so a
      // per-household lookup finds the editable year before historical ones.
      allocations: j.allocations
        .map((a) => ({
          budgetYearId: a.budgetYearId,
          allocationPct: a.allocationPct,
          budgetYear: a.budgetYear,
          isDefaultYear: defaultYearIds.has(a.budgetYearId),
        }))
        .sort((a, b) => Number(b.isDefaultYear) - Number(a.isDefaultYear) || b.budgetYear.year - a.budgetYear.year),
    }))

    return reply.send(result)
  })

  // POST /users/:id/jobs
  fastify.post('/users/:id/jobs', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (userId !== targetUserId) {
      if (['SYSTEM_ADMIN', 'BOOKKEEPER'].includes(role)) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } })
        if (!target?.isProxy) return reply.status(403).send({ error: 'Forbidden' })
      } else {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    const result = CreateJobSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { name, employer, country, startDate, endDate } = result.data
    const job = await prisma.job.create({
      data: {
        userId: targetUserId,
        name,
        employer,
        country,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
      },
    })

    return reply.status(201).send(job)
  })

  // PUT /users/:id/jobs/:jobId
  fastify.put('/users/:id/jobs/:jobId', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { id: string; jobId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = UpdateJobSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { name, employer, country, startDate, endDate } = result.data
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        ...(name !== undefined && { name }),
        ...(employer !== undefined && { employer }),
        ...(country !== undefined && { country }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
      },
    })

    return reply.send(updated)
  })

  // DELETE /users/:id/jobs/:jobId — soft-close by setting endDate = today
  fastify.delete('/users/:id/jobs/:jobId', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { id: string; jobId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: { endDate: new Date() },
    })

    return reply.send(updated)
  })

  // ── Salary records ────────────────────────────────────────────────────────────

  // GET /jobs/:id/salary
  fastify.get('/jobs/:id/salary', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const records = await prisma.salaryRecord.findMany({
      where: { jobId },
      orderBy: { effectiveFrom: 'desc' },
    })

    return reply.send(records)
  })

  // POST /jobs/:id/salary
  fastify.post('/jobs/:id/salary', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = CreateSalarySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { grossAmount, netAmount, effectiveFrom, currencyCode, payslipLines } = result.data
    const currency = currencyCode && currencyCode !== BASE_CURRENCY ? currencyCode : null
    const rate = currency ? await getLatestRate(currency) : null
    if (currency && rate === null) {
      return reply.status(400).send({ error: `No exchange rate found for ${currency}` })
    }

    const deductions = await resolveDeductions(jobId, job.country, grossAmount, new Date(effectiveFrom), payslipLines as PayslipLine[] | undefined)

    const record = await prisma.salaryRecord.create({
      data: {
        jobId,
        grossAmount: new Decimal(grossAmount),
        netAmount: deductions.netAmount ?? new Decimal(netAmount),
        effectiveFrom: new Date(effectiveFrom),
        currencyCode: currency,
        rateUsed: rate !== null ? new Decimal(rate) : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payslipLines: deductions.payslipLines ? (deductions.payslipLines as any) : undefined,
        pensionEmployerMonthly: deductions.pensionEmployerMonthly,
        deductionsSource: deductions.deductionsSource,
      },
    })

    return reply.status(201).send(record)
  })

  // PUT /jobs/:id/salary/:salaryId
  fastify.put('/jobs/:id/salary/:salaryId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, salaryId } = request.params as { id: string; salaryId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = CreateSalarySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const existing = await prisma.salaryRecord.findFirst({ where: { id: salaryId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Salary record not found' })

    const { grossAmount, netAmount, effectiveFrom, currencyCode, payslipLines } = result.data
    const currency = currencyCode && currencyCode !== BASE_CURRENCY ? currencyCode : null
    const rate = currency ? await getLatestRate(currency) : null
    if (currency && rate === null) {
      return reply.status(400).send({ error: `No exchange rate found for ${currency}` })
    }

    const deductions = await resolveDeductions(jobId, job.country, grossAmount, new Date(effectiveFrom), payslipLines as PayslipLine[] | undefined)

    const record = await prisma.salaryRecord.update({
      where: { id: salaryId },
      data: {
        grossAmount: new Decimal(grossAmount),
        netAmount: deductions.netAmount ?? new Decimal(netAmount),
        effectiveFrom: new Date(effectiveFrom),
        currencyCode: currency,
        rateUsed: rate !== null ? new Decimal(rate) : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payslipLines: deductions.payslipLines ? (deductions.payslipLines as any) : undefined,
        pensionEmployerMonthly: deductions.pensionEmployerMonthly,
        deductionsSource: deductions.deductionsSource,
      },
    })

    return reply.send(record)
  })

  // DELETE /jobs/:id/salary/:salaryId
  fastify.delete('/jobs/:id/salary/:salaryId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, salaryId } = request.params as { id: string; salaryId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.salaryRecord.findFirst({ where: { id: salaryId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Salary record not found' })

    await prisma.salaryRecord.delete({ where: { id: salaryId } })

    return reply.status(204).send()
  })

  // ── Monthly overrides ─────────────────────────────────────────────────────────

  // GET /jobs/:id/overrides
  fastify.get('/jobs/:id/overrides', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const queryResult = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).safeParse(request.query)
    if (!queryResult.success) return reply.status(400).send({ error: 'Invalid query parameters' })
    const { year } = queryResult.data

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const overrides = await prisma.monthlyIncomeOverride.findMany({
      where: { jobId, ...(year !== undefined ? { year } : {}) },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })

    return reply.send(overrides)
  })

  // POST /jobs/:id/overrides — upsert
  fastify.post('/jobs/:id/overrides', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = OverrideSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { year, month, grossAmount, netAmount, note, payslipLines } = result.data

    const deductions = await resolveDeductions(jobId, job.country, grossAmount, monthStartUTC(year, month), payslipLines as PayslipLine[] | undefined)

    const resolvedNet = deductions.netAmount ?? new Decimal(netAmount)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deductionData: any = {
      payslipLines: deductions.payslipLines ?? undefined,
      pensionEmployerMonthly: deductions.pensionEmployerMonthly,
      deductionsSource: deductions.deductionsSource,
    }

    const override = await prisma.monthlyIncomeOverride.upsert({
      where: { jobId_year_month: { jobId, year, month } },
      create: { jobId, year, month, grossAmount: new Decimal(grossAmount), netAmount: resolvedNet, note, ...deductionData },
      update: { grossAmount: new Decimal(grossAmount), netAmount: resolvedNet, note, ...deductionData },
    })

    return reply.status(201).send(override)
  })

  // DELETE /jobs/:id/overrides/:overrideId
  fastify.delete('/jobs/:id/overrides/:overrideId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, overrideId } = request.params as { id: string; overrideId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.monthlyIncomeOverride.findFirst({ where: { id: overrideId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Override not found' })

    await prisma.monthlyIncomeOverride.delete({ where: { id: overrideId } })
    return reply.status(204).send()
  })

  // ── Tax card settings ─────────────────────────────────────────────────────────

  // GET /jobs/:id/taxcard
  fastify.get('/jobs/:id/taxcard', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const settings = await prisma.taxCardSettings.findMany({
      where: { jobId },
      orderBy: { effectiveFrom: 'desc' },
    })

    return reply.send(settings)
  })

  // POST /jobs/:id/taxcard
  fastify.post('/jobs/:id/taxcard', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = CreateTaxCardSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const {
      effectiveFrom, traekprocent, personfradragMonthly, municipality,
      pensionEmployeePct, pensionEmployerPct, atpAmount, bruttoItems,
    } = result.data

    const settings = await prisma.taxCardSettings.create({
      data: {
        jobId,
        effectiveFrom: new Date(effectiveFrom),
        traekprocent: new Decimal(traekprocent),
        personfradragMonthly: new Decimal(personfradragMonthly),
        municipality: municipality ?? null,
        pensionEmployeePct: pensionEmployeePct != null ? new Decimal(pensionEmployeePct) : null,
        pensionEmployerPct: pensionEmployerPct != null ? new Decimal(pensionEmployerPct) : null,
        atpAmount: atpAmount != null ? new Decimal(atpAmount) : null,
        bruttoItems: bruttoItems ?? undefined,
      },
    })

    await recalculateSalaryDeductions(jobId, job.country)

    return reply.status(201).send(settings)
  })

  // PUT /jobs/:id/taxcard/:settingsId
  fastify.put('/jobs/:id/taxcard/:settingsId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, settingsId } = request.params as { id: string; settingsId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.taxCardSettings.findFirst({ where: { id: settingsId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Tax card settings not found' })

    const result = UpdateTaxCardSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const data = result.data
    const updated = await prisma.taxCardSettings.update({
      where: { id: settingsId },
      data: {
        ...(data.effectiveFrom !== undefined && { effectiveFrom: new Date(data.effectiveFrom) }),
        ...(data.traekprocent !== undefined && { traekprocent: new Decimal(data.traekprocent) }),
        ...(data.personfradragMonthly !== undefined && { personfradragMonthly: new Decimal(data.personfradragMonthly) }),
        ...(data.municipality !== undefined && { municipality: data.municipality }),
        ...(data.pensionEmployeePct !== undefined && { pensionEmployeePct: data.pensionEmployeePct != null ? new Decimal(data.pensionEmployeePct) : null }),
        ...(data.pensionEmployerPct !== undefined && { pensionEmployerPct: data.pensionEmployerPct != null ? new Decimal(data.pensionEmployerPct) : null }),
        ...(data.atpAmount !== undefined && { atpAmount: data.atpAmount != null ? new Decimal(data.atpAmount) : null }),
        ...(data.bruttoItems !== undefined && { bruttoItems: data.bruttoItems ?? null }),
      },
    })

    await recalculateSalaryDeductions(jobId, job.country)

    return reply.send(updated)
  })

  // DELETE /jobs/:id/taxcard/:settingsId
  fastify.delete('/jobs/:id/taxcard/:settingsId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, settingsId } = request.params as { id: string; settingsId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.taxCardSettings.findFirst({ where: { id: settingsId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Tax card settings not found' })

    await prisma.taxCardSettings.delete({ where: { id: settingsId } })
    return reply.status(204).send()
  })

  // ── Bonuses ───────────────────────────────────────────────────────────────────

  // GET /jobs/:id/bonuses
  fastify.get('/jobs/:id/bonuses', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const bonuses = await prisma.bonus.findMany({
      where: { jobId },
      orderBy: { paymentDate: 'desc' },
    })

    return reply.send(bonuses)
  })

  // POST /jobs/:id/bonuses
  fastify.post('/jobs/:id/bonuses', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const result = CreateBonusSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { label, grossAmount, netAmount, paymentDate, includeInBudget, budgetMode, currencyCode } = result.data
    const bonusCurrency = currencyCode && currencyCode !== BASE_CURRENCY ? currencyCode : null
    const bonusRate = bonusCurrency ? await getLatestRate(bonusCurrency) : null
    if (bonusCurrency && bonusRate === null) {
      return reply.status(400).send({ error: `No exchange rate found for ${bonusCurrency}` })
    }

    const bonus = await prisma.bonus.create({
      data: {
        jobId,
        label,
        grossAmount: new Decimal(grossAmount),
        netAmount: new Decimal(netAmount),
        paymentDate: new Date(paymentDate),
        includeInBudget,
        budgetMode: includeInBudget ? (budgetMode ?? null) : null,
        currencyCode: bonusCurrency,
        rateUsed: bonusRate !== null ? new Decimal(bonusRate) : null,
      },
    })

    return reply.status(201).send(bonus)
  })

  // PUT /jobs/:id/bonuses/:bonusId
  fastify.put('/jobs/:id/bonuses/:bonusId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, bonusId } = request.params as { id: string; bonusId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.bonus.findFirst({ where: { id: bonusId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Bonus not found' })

    const result = UpdateBonusSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const data = result.data
    const newInclude = data.includeInBudget ?? existing.includeInBudget

    let bonusCurrency: string | null = existing.currencyCode
    let bonusRate: number | null = existing.rateUsed ? toNum(existing.rateUsed) : null
    if (data.currencyCode !== undefined) {
      bonusCurrency = data.currencyCode && data.currencyCode !== BASE_CURRENCY ? data.currencyCode : null
      if (bonusCurrency) {
        bonusRate = await getLatestRate(bonusCurrency)
        if (bonusRate === null) return reply.status(400).send({ error: `No exchange rate found for ${bonusCurrency}` })
      } else {
        bonusRate = null
      }
    }

    const updated = await prisma.bonus.update({
      where: { id: bonusId },
      data: {
        ...(data.label !== undefined && { label: data.label }),
        ...(data.grossAmount !== undefined && { grossAmount: new Decimal(data.grossAmount) }),
        ...(data.netAmount !== undefined && { netAmount: new Decimal(data.netAmount) }),
        ...(data.paymentDate !== undefined && { paymentDate: new Date(data.paymentDate) }),
        includeInBudget: newInclude,
        budgetMode: newInclude ? (data.budgetMode ?? existing.budgetMode) : null,
        currencyCode: bonusCurrency,
        rateUsed: bonusRate !== null ? new Decimal(bonusRate) : null,
      },
    })

    return reply.send(updated)
  })

  // DELETE /jobs/:id/bonuses/:bonusId
  fastify.delete('/jobs/:id/bonuses/:bonusId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, bonusId } = request.params as { id: string; bonusId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const existing = await prisma.bonus.findFirst({ where: { id: bonusId, jobId } })
    if (!existing) return reply.status(404).send({ error: 'Bonus not found' })

    await prisma.bonus.delete({ where: { id: bonusId } })
    return reply.status(204).send()
  })

  // ── Allocations ───────────────────────────────────────────────────────────────

  // PUT /income/:id/allocations/:householdId — :id is now a jobId
  fastify.put('/income/:id/allocations/:householdId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, householdId } = request.params as { id: string; householdId: string }
    const { sub: userId, role } = request.user

    const result = AllocationSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    // The job's owner must belong to the household — a bookkeeper or admin managing
    // someone's income can't route it into a household that person isn't part of
    const ownerMembership = await getActiveMembership(householdId, job.userId)
    if (!ownerMembership) return reply.status(403).send({ error: 'The job owner is not a member of this household' })

    const budgetYear = await findDefaultBudgetYear(householdId)
    if (!budgetYear) return reply.status(409).send(NO_BUDGET_YEAR_ERROR)

    const allocation = await prisma.householdIncomeAllocation.upsert({
      where: { jobId_budgetYearId: { jobId, budgetYearId: budgetYear.id } },
      create: { jobId, budgetYearId: budgetYear.id, allocationPct: new Decimal(result.data.allocationPct) },
      update: { allocationPct: new Decimal(result.data.allocationPct) },
    })

    return reply.send(allocation)
  })

  // DELETE /income/:id/allocations/:householdId
  // Removes the allocation from the same budget year PUT writes to (the
  // household's default ACTIVE/FUTURE year). Retired years are history and
  // simulations are edited separately, so both keep their allocations.
  fastify.delete('/income/:id/allocations/:householdId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, householdId } = request.params as { id: string; householdId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const budgetYear = await findDefaultBudgetYear(householdId)
    if (budgetYear) {
      await prisma.householdIncomeAllocation.deleteMany({
        where: { jobId, budgetYearId: budgetYear.id },
      })
    }

    return reply.status(204).send()
  })

  // ── Income history ────────────────────────────────────────────────────────────

  // GET /users/:id/income/history?from=YYYY-MM&to=YYYY-MM&granularity=monthly|quarterly|yearly
  fastify.get('/users/:id/income/history', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId } = request.params as { id: string }
    const queryResult = z.object({
      granularity: z.enum(['monthly', 'quarterly', 'yearly']).default('monthly'),
      from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
      to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    }).safeParse(request.query)
    if (!queryResult.success) return reply.status(400).send({ error: 'Invalid query parameters' })
    const { from, to, granularity } = queryResult.data
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN' && userId !== targetUserId) {
      if (role === 'BOOKKEEPER') {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } })
        if (!target?.isProxy) return reply.status(403).send({ error: 'Forbidden' })
      } else {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    const now = new Date()
    const parseYearMonth = (v: string) => {
      const [year, month] = v.split('-').map(Number)
      return { year, month }
    }
    const fromYM = from ? parseYearMonth(from) : { year: now.getFullYear(), month: 1 }
    const toYM = to ? parseYearMonth(to) : yearMonthOfLocalDate(now)

    const jobs = await prisma.job.findMany({
      where: { userId: targetUserId },
      include: JOB_INCOME_INCLUDE,
    })

    // Salary/overrides converted to base currency, jobs limited to their
    // start/end months, bonuses by budget mode (SPREAD_ANNUALLY ÷12 per month).
    const buckets = buildIncomeHistory(jobs, fromYM, toYM, granularity)

    return reply.send({ buckets })
  })

  // ── Income summary for household ──────────────────────────────────────────────

  // GET /households/:id/income-summary
  fastify.get('/households/:id/income-summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        // No orderBy on status: Postgres sorts enums in declaration order
        // (FUTURE before ACTIVE). pickDefaultBudgetYear prefers ACTIVE.
        budgetYears: {
          where: { status: { in: ['ACTIVE', 'FUTURE'] } },
        },
      },
    })

    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const activeBudgetYear = pickDefaultBudgetYear(household.budgetYears)
    if (!activeBudgetYear) {
      return reply.send({ budgetYear: null, members: [], totalMonthly: '0.00' })
    }

    const referenceDate = getIncomeReferenceDate(activeBudgetYear.year, activeBudgetYear.status)
    const income = await calcIncomeForYearDetailed(activeBudgetYear.id, referenceDate)
    const ZERO = new Decimal(0)

    const memberSummaries = household.members.map((m) => {
      const allocations = income.allocations.filter((a) => a.userId === m.userId)
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        allocatedNet: allocations.reduce((s, a) => s.plus(a.allocatedNet), ZERO),
        allocatedGross: allocations.reduce((s, a) => s.plus(a.allocatedGross), ZERO),
        entries: allocations.map((a) => ({
          id: a.job.id,
          label: a.job.name,
          employer: a.job.employer,
          monthlyGross: a.monthlyGross.toDecimalPlaces(2).toNumber(),
          monthlyNet: a.monthlyNet.toDecimalPlaces(2).toNumber(),
          allocationPct: a.allocationPct.toNumber(),
          monthlyAllocatedGross: a.allocatedGross.toFixed(2),
          monthlyAllocated: a.allocatedNet.toFixed(2),
        })),
      }
    })

    const totalMonthly = memberSummaries.reduce((s, m) => s.plus(m.allocatedNet), ZERO)
    const shares = computeIncomeShares(
      memberSummaries.map((m) => m.userId),
      new Map(memberSummaries.map((m) => [m.userId, m.allocatedGross])),
    )

    const membersWithShare = memberSummaries.map(({ allocatedNet, allocatedGross, ...m }) => ({
      ...m,
      monthlyAllocated: allocatedNet.toFixed(2),
      monthlyAllocatedGross: allocatedGross.toFixed(2),
      sharePct: formatSharePct(shares.get(m.userId)),
    }))

    return reply.send({
      budgetYear: { id: activeBudgetYear.id, year: activeBudgetYear.year, status: activeBudgetYear.status },
      members: membersWithShare,
      totalMonthly: totalMonthly.toFixed(2),
    })
  })
}
