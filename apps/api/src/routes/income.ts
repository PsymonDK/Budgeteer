import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent, deriveBudgetStatus } from '../lib/calculations'

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CreateIncomeSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  frequencyPeriod: z.string().optional(),
})

const UpdateIncomeSchema = CreateIncomeSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const AllocationSchema = z.object({
  allocationPct: z.number().min(0).max(999),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

// Finds the active/future budget year for a household, auto-creating if absent
async function getOrCreateActiveBudgetYear(householdId: string) {
  const year = new Date().getFullYear()
  const existing = await prisma.budgetYear.findFirst({
    where: { householdId, status: { in: ['ACTIVE', 'FUTURE'] } },
    orderBy: { year: 'asc' },
  })
  if (existing) return existing
  return prisma.budgetYear.create({
    data: { householdId, year, status: deriveBudgetStatus(year) },
  })
}

// Returns total allocated % across non-retired budget years for one income entry
async function totalAllocatedPct(incomeEntryId: string): Promise<number> {
  const allocations = await prisma.householdIncomeAllocation.findMany({
    where: {
      incomeEntryId,
      budgetYear: { status: { not: 'RETIRED' } },
    },
    select: { allocationPct: true },
  })
  return allocations.reduce((sum, a) => sum + parseFloat(a.allocationPct.toString()), 0)
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function incomeRoutes(fastify: FastifyInstance) {
  // GET /income — current user's income entries with allocations + over-allocation flag
  fastify.get('/income', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user

    const entries = await prisma.incomeEntry.findMany({
      where: { userId },
      include: {
        allocations: {
          include: {
            budgetYear: {
              select: {
                id: true, year: true, status: true,
                household: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const result = entries.map((e) => {
      const nonRetired = e.allocations.filter((a) => a.budgetYear.status !== 'RETIRED')
      const pctTotal = nonRetired.reduce((sum, a) => sum + parseFloat(a.allocationPct.toString()), 0)
      return { ...e, totalAllocatedPct: pctTotal, overAllocated: pctTotal > 100 }
    })

    return reply.send(result)
  })

  // POST /income
  fastify.post('/income', { preHandler: authenticate }, async (request, reply) => {
    const result = CreateIncomeSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }
    const { label, amount, frequency, frequencyPeriod } = result.data
    const { sub: userId } = request.user

    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amount), frequency)

    const entry = await prisma.incomeEntry.create({
      data: { userId, label, amount: new Decimal(amount), frequency, frequencyPeriod: frequencyPeriod ?? null, monthlyEquivalent },
      include: { allocations: true },
    })

    return reply.status(201).send({ ...entry, totalAllocatedPct: 0, overAllocated: false })
  })

  // PUT /income/:id
  fastify.put('/income/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId } = request.user

    const result = UpdateIncomeSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const existing = await prisma.incomeEntry.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return reply.status(404).send({ error: 'Income entry not found' })
    }

    const { amount, frequency, ...rest } = result.data
    const newAmount = amount !== undefined ? new Decimal(amount) : existing.amount
    const newFrequency = frequency ?? existing.frequency
    const monthlyEquivalent = calcMonthlyEquivalent(newAmount, newFrequency)

    const entry = await prisma.incomeEntry.update({
      where: { id },
      data: {
        ...rest,
        ...(amount !== undefined && { amount: newAmount }),
        ...(frequency !== undefined && { frequency }),
        monthlyEquivalent,
      },
      include: {
        allocations: {
          include: {
            budgetYear: {
              select: { id: true, year: true, status: true, household: { select: { id: true, name: true } } },
            },
          },
        },
      },
    })

    const pctTotal = await totalAllocatedPct(id)
    return reply.send({ ...entry, totalAllocatedPct: pctTotal, overAllocated: pctTotal > 100 })
  })

  // DELETE /income/:id
  fastify.delete('/income/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId } = request.user

    const existing = await prisma.incomeEntry.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return reply.status(404).send({ error: 'Income entry not found' })
    }

    // Cascade: allocations deleted by Prisma via relation if onDelete: Cascade,
    // otherwise delete manually first
    await prisma.householdIncomeAllocation.deleteMany({ where: { incomeEntryId: id } })
    await prisma.incomeEntry.delete({ where: { id } })

    return reply.status(204).send()
  })

  // PUT /income/:id/allocations/:householdId — set allocation % for a household
  // Uses (or creates) the household's active budget year automatically
  fastify.put('/income/:id/allocations/:householdId', { preHandler: authenticate }, async (request, reply) => {
    const { id, householdId } = request.params as { id: string; householdId: string }
    const { sub: userId } = request.user

    const result = AllocationSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const entry = await prisma.incomeEntry.findUnique({ where: { id } })
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: 'Income entry not found' })
    }

    // Caller must be a member of the target household
    const membership = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
    })
    if (!membership) return reply.status(403).send({ error: 'You are not a member of this household' })

    const budgetYear = await getOrCreateActiveBudgetYear(householdId)

    const allocation = await prisma.householdIncomeAllocation.upsert({
      where: { incomeEntryId_budgetYearId: { incomeEntryId: id, budgetYearId: budgetYear.id } },
      create: { incomeEntryId: id, budgetYearId: budgetYear.id, allocationPct: new Decimal(result.data.allocationPct) },
      update: { allocationPct: new Decimal(result.data.allocationPct) },
    })

    const pctTotal = await totalAllocatedPct(id)
    return reply.send({ ...allocation, totalAllocatedPct: pctTotal, overAllocated: pctTotal > 100 })
  })

  // DELETE /income/:id/allocations/:householdId
  fastify.delete('/income/:id/allocations/:householdId', { preHandler: authenticate }, async (request, reply) => {
    const { id, householdId } = request.params as { id: string; householdId: string }
    const { sub: userId } = request.user

    const entry = await prisma.incomeEntry.findUnique({ where: { id } })
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: 'Income entry not found' })
    }

    // Delete allocations for all budget years belonging to this household
    await prisma.householdIncomeAllocation.deleteMany({
      where: { incomeEntryId: id, budgetYear: { householdId } },
    })

    return reply.status(204).send()
  })

  // GET /households/:id/income-summary
  // Per-member income breakdown for the household's active budget year
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

    const memberSummaries = await Promise.all(
      household.members.map(async (m) => {
        const incomeEntries = await prisma.incomeEntry.findMany({
          where: {
            userId: m.userId,
            allocations: { some: { budgetYearId: activeBudgetYear.id } },
          },
          include: {
            allocations: { where: { budgetYearId: activeBudgetYear.id } },
          },
        })

        const entries = incomeEntries.map((e) => {
          const pct = parseFloat((e.allocations[0]?.allocationPct ?? '0').toString())
          const monthly = parseFloat(e.monthlyEquivalent.toString())
          return {
            id: e.id,
            label: e.label,
            frequency: e.frequency,
            monthlyEquivalent: e.monthlyEquivalent,
            allocationPct: pct,
            monthlyAllocated: (monthly * pct / 100).toFixed(2),
          }
        })

        const monthlyAllocated = entries.reduce((s, e) => s + parseFloat(e.monthlyAllocated), 0)

        return {
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          monthlyAllocated: monthlyAllocated.toFixed(2),
          entries,
        }
      })
    )

    const totalMonthly = memberSummaries.reduce((s, m) => s + parseFloat(m.monthlyAllocated), 0)

    const membersWithShare = memberSummaries.map((m) => ({
      ...m,
      sharePct: totalMonthly > 0
        ? ((parseFloat(m.monthlyAllocated) / totalMonthly) * 100).toFixed(1)
        : '0.0',
    }))

    return reply.send({
      budgetYear: { id: activeBudgetYear.id, year: activeBudgetYear.year, status: activeBudgetYear.status },
      members: membersWithShare,
      totalMonthly: totalMonthly.toFixed(2),
    })
  })
}
