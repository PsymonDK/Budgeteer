import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { getJobMonthlyIncome, getIncomeReferenceDate } from '../lib/incomeCalc'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateJobSchema = z.object({
  name: z.string().min(1).max(200),
  employer: z.string().max(200).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const UpdateJobSchema = CreateJobSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const CreateSalarySchema = z.object({
  grossAmount: z.number().positive(),
  netAmount: z.number().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currencyCode: z.string().length(3).toUpperCase().optional(),
})

const OverrideSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  grossAmount: z.number().positive(),
  netAmount: z.number().positive(),
  note: z.string().max(500).optional(),
})

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
  allocationPct: z.number().min(0).max(999),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateActiveBudgetYear(householdId: string) {
  const year = new Date().getFullYear()
  const existing = await prisma.budgetYear.findFirst({
    where: { householdId, status: { in: ['ACTIVE', 'FUTURE'] } },
    orderBy: { year: 'asc' },
  })
  if (existing) return existing
  return prisma.budgetYear.create({
    data: { householdId, year, status: 'ACTIVE' },
  })
}

async function assertJobOwnership(jobId: string, requesterId: string, requesterRole: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { user: true } })
  if (!job) return null
  if (job.userId === requesterId) return job
  // Bookkeeper or admin: may only access proxy users' jobs
  if (['SYSTEM_ADMIN', 'BOOKKEEPER'].includes(requesterRole) && job.user.isProxy) return job
  return null
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

    const result = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      employer: j.employer,
      startDate: j.startDate,
      endDate: j.endDate,
      isActive: j.endDate === null || j.endDate > new Date(),
      latestSalary: j.salaryRecords[0] ?? null,
      upcomingBonusCount: j.bonuses.length,
      allocations: j.allocations.map((a) => ({
        budgetYearId: a.budgetYearId,
        allocationPct: a.allocationPct,
        budgetYear: a.budgetYear,
      })),
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

    const { name, employer, startDate, endDate } = result.data
    const job = await prisma.job.create({
      data: {
        userId: targetUserId,
        name,
        employer,
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

    const { name, employer, startDate, endDate } = result.data
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        ...(name !== undefined && { name }),
        ...(employer !== undefined && { employer }),
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

    const { grossAmount, netAmount, effectiveFrom, currencyCode } = result.data
    const currency = currencyCode && currencyCode !== BASE_CURRENCY ? currencyCode : null
    const rate = currency ? await getLatestRate(currency) : null
    if (currency && rate === null) {
      return reply.status(400).send({ error: `No exchange rate found for ${currency}` })
    }

    const record = await prisma.salaryRecord.create({
      data: {
        jobId,
        grossAmount: new Decimal(grossAmount),
        netAmount: new Decimal(netAmount),
        effectiveFrom: new Date(effectiveFrom),
        currencyCode: currency,
        rateUsed: rate !== null ? new Decimal(rate) : null,
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

    const { grossAmount, netAmount, effectiveFrom, currencyCode } = result.data
    const currency = currencyCode && currencyCode !== BASE_CURRENCY ? currencyCode : null
    const rate = currency ? await getLatestRate(currency) : null
    if (currency && rate === null) {
      return reply.status(400).send({ error: `No exchange rate found for ${currency}` })
    }

    const record = await prisma.salaryRecord.update({
      where: { id: salaryId },
      data: {
        grossAmount: new Decimal(grossAmount),
        netAmount: new Decimal(netAmount),
        effectiveFrom: new Date(effectiveFrom),
        currencyCode: currency,
        rateUsed: rate !== null ? new Decimal(rate) : null,
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
    const { year } = request.query as { year?: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    const overrides = await prisma.monthlyIncomeOverride.findMany({
      where: { jobId, ...(year ? { year: parseInt(year, 10) } : {}) },
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

    const { year, month, grossAmount, netAmount, note } = result.data
    const override = await prisma.monthlyIncomeOverride.upsert({
      where: { jobId_year_month: { jobId, year, month } },
      create: { jobId, year, month, grossAmount: new Decimal(grossAmount), netAmount: new Decimal(netAmount), note },
      update: { grossAmount: new Decimal(grossAmount), netAmount: new Decimal(netAmount), note },
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
    let bonusRate: number | null = existing.rateUsed ? parseFloat(existing.rateUsed.toString()) : null
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

    const membership = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
    })
    if (!membership) return reply.status(403).send({ error: 'You are not a member of this household' })

    const budgetYear = await getOrCreateActiveBudgetYear(householdId)

    const allocation = await prisma.householdIncomeAllocation.upsert({
      where: { jobId_budgetYearId: { jobId, budgetYearId: budgetYear.id } },
      create: { jobId, budgetYearId: budgetYear.id, allocationPct: new Decimal(result.data.allocationPct) },
      update: { allocationPct: new Decimal(result.data.allocationPct) },
    })

    return reply.send(allocation)
  })

  // DELETE /income/:id/allocations/:householdId
  fastify.delete('/income/:id/allocations/:householdId', { preHandler: authenticate }, async (request, reply) => {
    const { id: jobId, householdId } = request.params as { id: string; householdId: string }
    const { sub: userId, role } = request.user

    const job = await assertJobOwnership(jobId, userId, role)
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    await prisma.householdIncomeAllocation.deleteMany({
      where: { jobId, budgetYear: { householdId } },
    })

    return reply.status(204).send()
  })

  // ── Income history ────────────────────────────────────────────────────────────

  // GET /users/:id/income/history?from=YYYY-MM&to=YYYY-MM&granularity=monthly|quarterly|yearly
  fastify.get('/users/:id/income/history', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId } = request.params as { id: string }
    const { from, to, granularity = 'monthly' } = request.query as {
      from?: string
      to?: string
      granularity?: 'monthly' | 'quarterly' | 'yearly'
    }
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
    const fromDate = from ? new Date(`${from}-01`) : new Date(now.getFullYear(), 0, 1)
    const toDate = to ? new Date(`${to}-01`) : now

    const jobs = await prisma.job.findMany({
      where: { userId: targetUserId },
      include: {
        salaryRecords: { orderBy: { effectiveFrom: 'asc' } },
        overrides: true,
        bonuses: true,
      },
    })

    // Build time buckets
    type Bucket = {
      period: string
      gross: number
      net: number
      total: number
      perJob: { jobId: string; jobName: string; gross: number; net: number }[]
      bonuses: { jobId: string; label: string; gross: number; net: number }[]
    }

    const buckets: Bucket[] = []
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1)

    while (cursor <= toDate) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth() + 1
      let period: string

      if (granularity === 'monthly') {
        period = `${year}-${String(month).padStart(2, '0')}`
      } else if (granularity === 'quarterly') {
        const q = Math.ceil(month / 3)
        period = `${year}-Q${q}`
      } else {
        period = `${year}`
      }

      // Avoid duplicate buckets for quarterly/yearly granularity
      if (buckets.length > 0 && buckets[buckets.length - 1].period === period) {
        cursor.setMonth(cursor.getMonth() + 1)
        continue
      }

      const refDate = new Date(year, month - 1, 15) // mid-month reference
      const perJob: Bucket['perJob'] = []
      const bonusList: Bucket['bonuses'] = []

      for (const job of jobs) {
        // Skip jobs not yet started or ended before this month
        const jobStart = job.startDate
        const jobEnd = job.endDate
        const monthEnd = new Date(year, month - 1, 31)
        const monthStart = new Date(year, month - 1, 1)
        if (jobStart > monthEnd) continue
        if (jobEnd && jobEnd < monthStart) continue

        // Salary (net)
        const override = job.overrides.find((o) => o.year === year && o.month === month)
        let netMonthly: number
        let grossMonthly: number

        if (override) {
          netMonthly = parseFloat(override.netAmount.toString())
          grossMonthly = parseFloat(override.grossAmount.toString())
        } else {
          const salary = job.salaryRecords
            .filter((s) => s.effectiveFrom <= refDate)
            .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
          netMonthly = salary ? parseFloat(salary.netAmount.toString()) : 0
          grossMonthly = salary ? parseFloat(salary.grossAmount.toString()) : 0
        }

        perJob.push({ jobId: job.id, jobName: job.name, gross: grossMonthly, net: netMonthly })

        // Bonuses in this month
        for (const bonus of job.bonuses) {
          if (!bonus.includeInBudget) continue
          const bd = bonus.paymentDate
          let addNet = 0
          let addGross = 0

          if (bonus.budgetMode === 'ONE_OFF') {
            if (bd.getFullYear() === year && bd.getMonth() + 1 === month) {
              addNet = parseFloat(bonus.netAmount.toString())
              addGross = parseFloat(bonus.grossAmount.toString())
            }
          } else if (bonus.budgetMode === 'SPREAD_ANNUALLY') {
            addNet = parseFloat(bonus.netAmount.toString()) / 12
            addGross = parseFloat(bonus.grossAmount.toString()) / 12
          }

          if (addNet > 0 || addGross > 0) {
            bonusList.push({ jobId: job.id, label: bonus.label, gross: addGross, net: addNet })
          }
        }
      }

      const grossTotal = perJob.reduce((s, j) => s + j.gross, 0) + bonusList.reduce((s, b) => s + b.gross, 0)
      const netTotal = perJob.reduce((s, j) => s + j.net, 0) + bonusList.reduce((s, b) => s + b.net, 0)

      buckets.push({
        period,
        gross: grossTotal,
        net: netTotal,
        total: netTotal,
        perJob,
        bonuses: bonusList,
      })

      cursor.setMonth(cursor.getMonth() + 1)
    }

    return reply.send({ buckets })
  })

  // ── Income summary for household ──────────────────────────────────────────────

  // GET /households/:id/income-summary
  fastify.get('/households/:id/income-summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const member = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        budgetYears: {
          where: { status: { in: ['ACTIVE', 'FUTURE'] } },
          orderBy: [{ status: 'asc' }, { year: 'asc' }],
          take: 1,
        },
      },
    })

    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const activeBudgetYear = household.budgetYears[0] ?? null
    if (!activeBudgetYear) {
      return reply.send({ budgetYear: null, members: [], totalMonthly: '0.00' })
    }

    const referenceDate = getIncomeReferenceDate(activeBudgetYear.year, activeBudgetYear.status)

    const memberSummaries = await Promise.all(
      household.members.map(async (m) => {
        const allocations = await prisma.householdIncomeAllocation.findMany({
          where: { budgetYearId: activeBudgetYear.id, job: { userId: m.userId } },
          include: { job: true },
        })

        const entries = await Promise.all(
          allocations.map(async (alloc) => {
            const pct = parseFloat(alloc.allocationPct.toString())
            const { gross, net } = await getJobMonthlyIncome(alloc.jobId, referenceDate)
            return {
              id: alloc.jobId,
              label: alloc.job.name,
              employer: alloc.job.employer,
              monthlyGross: gross,
              monthlyNet: net,
              allocationPct: pct,
              monthlyAllocatedGross: (gross * pct / 100).toFixed(2),
              monthlyAllocated: (net * pct / 100).toFixed(2),
            }
          })
        )

        const monthlyAllocatedNet = entries.reduce((s, e) => s + parseFloat(e.monthlyAllocated), 0)
        const monthlyAllocatedGross = entries.reduce((s, e) => s + parseFloat(e.monthlyAllocatedGross), 0)

        return {
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          monthlyAllocated: monthlyAllocatedNet.toFixed(2),
          monthlyAllocatedGross: monthlyAllocatedGross.toFixed(2),
          entries,
        }
      })
    )

    const totalMonthly = memberSummaries.reduce((s, m) => s + parseFloat(m.monthlyAllocated), 0)
    const grossTotalMonthly = memberSummaries.reduce((s, m) => s + parseFloat(m.monthlyAllocatedGross), 0)

    const membersWithShare = memberSummaries.map((m) => ({
      ...m,
      sharePct: grossTotalMonthly > 0
        ? ((parseFloat(m.monthlyAllocatedGross) / grossTotalMonthly) * 100).toFixed(1)
        : '0.0',
    }))

    return reply.send({
      budgetYear: { id: activeBudgetYear.id, year: activeBudgetYear.year, status: activeBudgetYear.status },
      members: membersWithShare,
      totalMonthly: totalMonthly.toFixed(2),
    })
  })
}
