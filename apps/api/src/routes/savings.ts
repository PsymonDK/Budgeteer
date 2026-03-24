import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent } from '../lib/calculations'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CreateSavingsSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  notes: z.string().optional(),
})

const UpdateSavingsSchema = CreateSavingsSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertBudgetYearAccess(budgetYearId: string, userId: string, systemAdmin: boolean) {
  const budgetYear = await prisma.budgetYear.findUnique({
    where: { id: budgetYearId },
    include: {
      household: { include: { members: { where: { userId } } } },
    },
  })
  if (!budgetYear) return null
  if (!systemAdmin && budgetYear.household.members.length === 0) return null
  return budgetYear
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function savingsRoutes(fastify: FastifyInstance) {
  // GET /budget-years/:id/savings
  fastify.get('/budget-years/:id/savings', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const entries = await prisma.savingsEntry.findMany({
      where: { budgetYearId: id },
      orderBy: { label: 'asc' },
    })

    return reply.send(entries)
  })

  // POST /budget-years/:id/savings
  fastify.post('/budget-years/:id/savings', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const result = CreateSavingsSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { label, amount, frequency, notes } = result.data
    const amountDecimal = new Decimal(amount)
    const monthlyEquivalent = calcMonthlyEquivalent(amountDecimal, frequency)

    const entry = await prisma.savingsEntry.create({
      data: { budgetYearId: id, label, amount: amountDecimal, frequency, monthlyEquivalent, notes },
    })

    return reply.status(201).send(entry)
  })

  // PUT /budget-years/:id/savings/:entryId
  fastify.put('/budget-years/:id/savings/:entryId', { preHandler: authenticate }, async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const existing = await prisma.savingsEntry.findFirst({ where: { id: entryId, budgetYearId: id } })
    if (!existing) return reply.status(404).send({ error: 'Savings entry not found' })

    const result = UpdateSavingsSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const data = result.data
    const amount = data.amount !== undefined ? new Decimal(data.amount) : existing.amount
    const frequency = data.frequency ?? existing.frequency
    const monthlyEquivalent = calcMonthlyEquivalent(amount, frequency)

    const updated = await prisma.savingsEntry.update({
      where: { id: entryId },
      data: { label: data.label, amount, frequency, monthlyEquivalent, notes: data.notes },
    })

    return reply.send(updated)
  })

  // DELETE /budget-years/:id/savings/:entryId
  fastify.delete('/budget-years/:id/savings/:entryId', { preHandler: authenticate }, async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const existing = await prisma.savingsEntry.findFirst({ where: { id: entryId, budgetYearId: id } })
    if (!existing) return reply.status(404).send({ error: 'Savings entry not found' })

    await prisma.savingsEntry.delete({ where: { id: entryId } })

    return reply.status(204).send()
  })

  // GET /households/:id/savings-history — savings rate per non-simulation year
  fastify.get('/households/:id/savings-history', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const member = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    const years = await prisma.budgetYear.findMany({
      where: { householdId, status: { not: 'SIMULATION' } },
      include: { savingsEntries: true },
      orderBy: { year: 'asc' },
    })

    // For each year, calculate income and savings totals
    const rows = await Promise.all(
      years.map(async (y) => {
        const allocs = await prisma.householdIncomeAllocation.findMany({
          where: { budgetYearId: y.id },
          include: { incomeEntry: { select: { monthlyEquivalent: true } } },
        })
        const income = allocs.reduce(
          (s, a) => s + parseFloat(a.incomeEntry.monthlyEquivalent.toString()) * parseFloat(a.allocationPct.toString()) / 100,
          0
        )
        const savings = y.savingsEntries.reduce(
          (s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0
        )
        return {
          year: y.year,
          status: y.status,
          totalMonthlyIncome: income.toFixed(2),
          totalMonthlySavings: savings.toFixed(2),
          savingsRate: income > 0 ? ((savings / income) * 100).toFixed(1) : null,
        }
      })
    )

    return reply.send(rows)
  })
}
