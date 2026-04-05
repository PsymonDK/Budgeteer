import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { deriveBudgetStatus } from '../lib/calculations'
import { assertHouseholdAccess } from '../lib/ownership'
import { recalculateTransfer } from '../lib/budgetTransfer'

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateBudgetYearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
})

const CopyBudgetYearSchema = z.union([
  z.object({ year: z.number().int().min(2000).max(2100) }),
  z.object({ simulationName: z.string().min(1).max(100) }),
])

const RenameSimulationSchema = z.object({
  simulationName: z.string().min(1).max(100),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertHouseholdAdmin(householdId: string, userId: string, role: string) {
  if (role === 'SYSTEM_ADMIN') return true
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
  return member?.role === 'ADMIN'
}

type SourceBudgetYear = Prisma.BudgetYearGetPayload<{
  include: { expenses: { include: { customSplits: true } }; savingsEntries: { include: { customSplits: true } } }
}>

async function copyBudgetYearContent(
  tx: Prisma.TransactionClient,
  source: SourceBudgetYear,
  targetId: string,
  memberIds: Set<string>,
) {
  for (const e of source.expenses) {
    const newExpense = await tx.expense.create({
      data: {
        budgetYearId: targetId,
        label: e.label,
        amount: e.amount,
        frequency: e.frequency,
        frequencyPeriod: e.frequencyPeriod,
        startMonth: e.startMonth,
        endMonth: e.endMonth,
        monthlyEquivalent: e.monthlyEquivalent,
        notes: e.notes,
        categoryId: e.categoryId,
        ownership: e.ownership,
        ownedByUserId: e.ownedByUserId,
      },
    })
    const validExpenseSplits = e.customSplits.filter((s) => memberIds.has(s.userId))
    if (validExpenseSplits.length > 0) {
      await tx.expenseCustomSplit.createMany({
        data: validExpenseSplits.map((s) => ({ expenseId: newExpense.id, userId: s.userId, pct: s.pct })),
      })
    }
  }
  for (const s of source.savingsEntries) {
    const newEntry = await tx.savingsEntry.create({
      data: {
        budgetYearId: targetId,
        label: s.label,
        amount: s.amount,
        frequency: s.frequency,
        monthlyEquivalent: s.monthlyEquivalent,
        notes: s.notes,
        ownership: s.ownership,
        ownedByUserId: s.ownedByUserId,
        categoryId: s.categoryId,
      },
    })
    const validSavingsSplits = s.customSplits.filter((sp) => memberIds.has(sp.userId))
    if (validSavingsSplits.length > 0) {
      await tx.savingsCustomSplit.createMany({
        data: validSavingsSplits.map((sp) => ({ savingsEntryId: newEntry.id, userId: sp.userId, pct: sp.pct })),
      })
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function budgetYearRoutes(fastify: FastifyInstance) {
  // GET /households/:id/budget-years — all years including simulations
  fastify.get('/households/:id/budget-years', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const years = await prisma.budgetYear.findMany({
      where: { householdId },
      include: {
        _count: { select: { expenses: true, savingsEntries: true } },
      },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
    })

    return reply.send(years)
  })

  // POST /households/:id/budget-years — create a regular (non-simulation) budget year
  fastify.post('/households/:id/budget-years', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = CreateBudgetYearSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const { year } = result.data

    const existing = await prisma.budgetYear.findFirst({
      where: { householdId, year, status: { not: 'SIMULATION' } },
    })
    if (existing) {
      return reply.status(409).send({ error: `A budget year for ${year} already exists` })
    }

    const status = deriveBudgetStatus(year)

    const budgetYear = await prisma.budgetYear.create({
      data: { householdId, year, status },
      include: { _count: { select: { expenses: true, savingsEntries: true } } },
    })

    if (status === 'ACTIVE') {
      recalculateTransfer(budgetYear.id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    }

    return reply.status(201).send(budgetYear)
  })

  // POST /households/:id/budget-years/:yearId/copy — copy expenses + savings to a new year or simulation
  fastify.post('/households/:id/budget-years/:yearId/copy', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const result = CopyBudgetYearSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Provide either { year } or { simulationName }', details: result.error.flatten() })
    }

    const [source, householdMembers] = await Promise.all([
      prisma.budgetYear.findFirst({
        where: { id: yearId, householdId },
        include: {
          expenses: { include: { customSplits: true } },
          savingsEntries: { include: { customSplits: true } },
        },
      }),
      prisma.householdMember.findMany({ where: { householdId }, select: { userId: true } }),
    ])
    if (!source) return reply.status(404).send({ error: 'Budget year not found' })

    const memberIds = new Set(householdMembers.map((m) => m.userId))
    const data = result.data

    if ('year' in data) {
      const existing = await prisma.budgetYear.findFirst({
        where: { householdId, year: data.year, status: { not: 'SIMULATION' } },
      })
      if (existing) {
        return reply.status(409).send({ error: `A budget year for ${data.year} already exists` })
      }

      const newYear = await prisma.$transaction(async (tx) => {
        const created = await tx.budgetYear.create({
          data: { householdId, year: data.year, status: deriveBudgetStatus(data.year), copiedFromId: source.id },
        })
        await copyBudgetYearContent(tx, source, created.id, memberIds)
        return tx.budgetYear.findUnique({
          where: { id: created.id },
          include: { _count: { select: { expenses: true, savingsEntries: true } } },
        })
      })

      return reply.status(201).send(newYear)
    } else {
      const newSim = await prisma.$transaction(async (tx) => {
        const created = await tx.budgetYear.create({
          data: {
            householdId,
            year: source.year,
            status: 'SIMULATION',
            simulationName: data.simulationName,
            copiedFromId: source.id,
          },
        })
        await copyBudgetYearContent(tx, source, created.id, memberIds)
        return tx.budgetYear.findUnique({
          where: { id: created.id },
          include: { _count: { select: { expenses: true, savingsEntries: true } } },
        })
      })

      return reply.status(201).send(newSim)
    }
  })

  // PATCH /households/:id/budget-years/:yearId — rename a simulation
  fastify.patch('/households/:id/budget-years/:yearId', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const result = RenameSimulationSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'simulationName is required', details: result.error.flatten() })
    }

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })
    if (target.status !== 'SIMULATION') return reply.status(400).send({ error: 'Only simulations can be renamed' })

    const updated = await prisma.budgetYear.update({
      where: { id: yearId },
      data: { simulationName: result.data.simulationName },
      include: { _count: { select: { expenses: true, savingsEntries: true } } },
    })

    return reply.send(updated)
  })

  // PATCH /households/:id/budget-years/:yearId/retire — manually retire a budget year
  fastify.patch('/households/:id/budget-years/:yearId/retire', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })
    if (target.status !== 'ACTIVE' && target.status !== 'FUTURE') {
      return reply.status(400).send({ error: 'Only active or future budget years can be retired' })
    }

    const updated = await prisma.budgetYear.update({
      where: { id: yearId },
      data: { status: 'RETIRED' },
      include: { _count: { select: { expenses: true, savingsEntries: true } } },
    })

    return reply.send(updated)
  })

  // PATCH /households/:id/budget-years/:yearId/promote — promote a simulation to active
  fastify.patch('/households/:id/budget-years/:yearId/promote', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })
    if (target.status !== 'SIMULATION') {
      return reply.status(400).send({ error: 'Only simulations can be promoted' })
    }

    const promoted = await prisma.$transaction(async (tx) => {
      await tx.budgetYear.updateMany({
        where: { householdId, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      })

      return tx.budgetYear.update({
        where: { id: yearId },
        data: { status: 'ACTIVE', simulationName: null },
        include: { _count: { select: { expenses: true, savingsEntries: true } } },
      })
    })

    recalculateTransfer(promoted.id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    return reply.send(promoted)
  })

  // DELETE /households/:id/budget-years/:yearId — delete a simulation
  fastify.delete('/households/:id/budget-years/:yearId', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })
    if (target.status !== 'SIMULATION') {
      return reply.status(400).send({ error: 'Only simulations can be deleted' })
    }

    await prisma.$transaction(async (tx) => {
      // Delete expense child records before expenses
      const expenses = await tx.expense.findMany({ where: { budgetYearId: yearId }, select: { id: true } })
      const expenseIds = expenses.map((e) => e.id)
      if (expenseIds.length > 0) {
        await tx.expenseOccurrence.deleteMany({ where: { expenseId: { in: expenseIds } } })
        await tx.expenseCustomSplit.deleteMany({ where: { expenseId: { in: expenseIds } } })
      }
      await tx.expense.deleteMany({ where: { budgetYearId: yearId } })

      // Delete savings child records before savings entries
      const savings = await tx.savingsEntry.findMany({ where: { budgetYearId: yearId }, select: { id: true } })
      const savingsIds = savings.map((s) => s.id)
      if (savingsIds.length > 0) {
        await tx.savingsOccurrence.deleteMany({ where: { savingsEntryId: { in: savingsIds } } })
        await tx.savingsCustomSplit.deleteMany({ where: { savingsEntryId: { in: savingsIds } } })
      }
      await tx.savingsEntry.deleteMany({ where: { budgetYearId: yearId } })

      await tx.householdIncomeAllocation.deleteMany({ where: { budgetYearId: yearId } })
      await tx.budgetTransfer.deleteMany({ where: { budgetYearId: yearId } })

      // Detach any budget years that were copied from this simulation
      await tx.budgetYear.updateMany({ where: { copiedFromId: yearId }, data: { copiedFromId: null } })

      await tx.budgetYear.delete({ where: { id: yearId } })
    })

    return reply.status(204).send()
  })
}
