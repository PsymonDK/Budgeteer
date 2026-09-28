import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { BudgetStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyInBase, deriveBudgetStatus } from '../lib/calculations'
import { BASE_CURRENCY, getLatestRate } from '../lib/currency'
import { assertHouseholdAccess, getActiveMembership } from '../lib/ownership'
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
  const member = await getActiveMembership(householdId, userId)
  return member?.role === 'ADMIN'
}

type SourceBudgetYear = Prisma.BudgetYearGetPayload<{
  include: { expenses: { include: { customSplits: true } }; savingsEntries: { include: { customSplits: true } } }
}>

type BudgetYearLifecycleTarget = {
  id: string
  year: number
  status: BudgetStatus
}

export function getRestoredRegularBudgetStatus(
  target: BudgetYearLifecycleTarget,
  currentYear = new Date().getFullYear(),
): 'ACTIVE' | 'FUTURE' | null {
  if (target.status !== 'RETIRED' || target.year < currentYear) return null
  const restoredStatus = deriveBudgetStatus(target.year)
  return restoredStatus === 'RETIRED' ? null : restoredStatus
}

export function canDeleteBudgetYear(
  target: BudgetYearLifecycleTarget,
  currentYear = new Date().getFullYear(),
): boolean {
  return target.status === 'SIMULATION' || (target.status === 'RETIRED' && target.year >= currentYear)
}

type CopyRates = Map<string, Prisma.Decimal | null>

/** Latest rate for every foreign currency used in the source year (null when unknown). */
export async function loadCopyRates(source: SourceBudgetYear): Promise<CopyRates> {
  const codes = new Set(
    [...source.expenses, ...source.savingsEntries]
      .map((e) => e.currencyCode)
      .filter((c): c is string => !!c && c !== BASE_CURRENCY),
  )
  const rates: CopyRates = new Map()
  for (const code of codes) {
    const rate = await getLatestRate(code)
    rates.set(code, rate === null ? null : new Prisma.Decimal(rate))
  }
  return rates
}

/**
 * Currency fields for a copied entry. A copy is a new, unlocked entry: foreign
 * amounts are re-priced at today's rate (or keep the source's rate when none is
 * available) so the copy doesn't silently turn into base currency.
 */
export function copiedCurrencyFields(
  e: {
    currencyCode: string | null
    originalAmount: Prisma.Decimal | null
    amount: Prisma.Decimal
    rateUsed: Prisma.Decimal | null
    monthlyEquivalent: Prisma.Decimal
    frequency: Parameters<typeof calcMonthlyInBase>[2]
    startMonth?: number | null
    endMonth?: number | null
  },
  rates: CopyRates,
) {
  if (!e.currencyCode || e.currencyCode === BASE_CURRENCY) {
    return { currencyCode: null, originalAmount: null, rateUsed: null, rateDate: null, monthlyEquivalent: e.monthlyEquivalent }
  }
  const original = e.originalAmount ?? e.amount
  const rate = rates.get(e.currencyCode) ?? e.rateUsed
  return {
    currencyCode: e.currencyCode,
    originalAmount: original,
    rateUsed: rate,
    rateDate: null,
    monthlyEquivalent: rate
      ? calcMonthlyInBase(original, rate, e.frequency, e.startMonth ?? null, e.endMonth ?? null)
      : e.monthlyEquivalent,
  }
}

async function copyBudgetYearContent(
  tx: Prisma.TransactionClient,
  source: SourceBudgetYear,
  targetId: string,
  memberIds: Set<string>,
  rates: CopyRates,
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
        notes: e.notes,
        categoryId: e.categoryId,
        ownership: e.ownership,
        ownedByUserId: e.ownedByUserId,
        accountId: e.accountId,
        ...copiedCurrencyFields(e, rates),
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
        frequencyPeriod: s.frequencyPeriod,
        notes: s.notes,
        ownership: s.ownership,
        ownedByUserId: s.ownedByUserId,
        categoryId: s.categoryId,
        accountId: s.accountId,
        ...copiedCurrencyFields(s, rates),
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

export async function deleteBudgetYearWithDependencies(
  tx: Prisma.TransactionClient,
  yearId: string,
) {
  const expenses = await tx.expense.findMany({ where: { budgetYearId: yearId }, select: { id: true } })
  const expenseIds = expenses.map((e) => e.id)
  if (expenseIds.length > 0) {
    await tx.expenseOccurrence.deleteMany({ where: { expenseId: { in: expenseIds } } })
    await tx.expenseCustomSplit.deleteMany({ where: { expenseId: { in: expenseIds } } })
  }
  await tx.expense.deleteMany({ where: { budgetYearId: yearId } })

  const savings = await tx.savingsEntry.findMany({ where: { budgetYearId: yearId }, select: { id: true } })
  const savingsIds = savings.map((s) => s.id)
  if (savingsIds.length > 0) {
    await tx.savingsOccurrence.deleteMany({ where: { savingsEntryId: { in: savingsIds } } })
    await tx.savingsCustomSplit.deleteMany({ where: { savingsEntryId: { in: savingsIds } } })
  }
  await tx.savingsEntry.deleteMany({ where: { budgetYearId: yearId } })

  await tx.householdIncomeAllocation.deleteMany({ where: { budgetYearId: yearId } })
  await tx.budgetTransfer.deleteMany({ where: { budgetYearId: yearId } })
  await tx.budgetYear.updateMany({ where: { copiedFromId: yearId }, data: { copiedFromId: null } })
  await tx.budgetYear.delete({ where: { id: yearId } })
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
      await recalculateTransfer(budgetYear.id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
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
    const rates = await loadCopyRates(source)

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
        await copyBudgetYearContent(tx, source, created.id, memberIds, rates)
        return tx.budgetYear.findUnique({
          where: { id: created.id },
          include: { _count: { select: { expenses: true, savingsEntries: true } } },
        })
      })

      if (newYear?.status === 'ACTIVE') await recalculateTransfer(newYear.id)

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
        await copyBudgetYearContent(tx, source, created.id, memberIds, rates)
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

  // PATCH /households/:id/budget-years/:yearId/promote — promote a simulation or restore a retired regular year
  fastify.patch('/households/:id/budget-years/:yearId/promote', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })

    if (target.status === 'SIMULATION') {
      // A simulation replaces the regular budget year for its own calendar year: a
      // 2027 simulation becomes the FUTURE 2027 year and leaves the live 2026 alone.
      const promotedStatus = deriveBudgetStatus(target.year)
      if (promotedStatus === 'RETIRED') {
        return reply.status(400).send({
          error: 'Simulations of past years cannot be promoted',
          code: 'BUDGET_YEAR_NOT_PROMOTABLE',
        })
      }

      const promoted = await prisma.$transaction(async (tx) => {
        await tx.budgetYear.updateMany({
          where: { householdId, year: target.year, status: { in: ['ACTIVE', 'FUTURE'] } },
          data: { status: 'RETIRED' },
        })

        return tx.budgetYear.update({
          where: { id: yearId },
          data: { status: promotedStatus, simulationName: null },
          include: { _count: { select: { expenses: true, savingsEntries: true } } },
        })
      })

      if (promotedStatus === 'ACTIVE') await recalculateTransfer(promoted.id)

      return reply.send(promoted)
    }

    const restoredStatus = getRestoredRegularBudgetStatus(target)
    if (!restoredStatus) {
      return reply.status(400).send({
        error: 'Only simulations or current/future retired budget years can be promoted',
        code: 'BUDGET_YEAR_NOT_PROMOTABLE',
      })
    }

    const restored = await prisma.$transaction(async (tx) => {
      if (restoredStatus === 'ACTIVE') {
        await tx.budgetYear.updateMany({
          where: { householdId, status: 'ACTIVE', id: { not: yearId } },
          data: { status: 'RETIRED' },
        })
      }

      return tx.budgetYear.update({
        where: { id: yearId },
        data: { status: restoredStatus },
        include: { _count: { select: { expenses: true, savingsEntries: true } } },
      })
    })

    if (restoredStatus === 'ACTIVE') {
      await recalculateTransfer(restored.id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    }

    return reply.send(restored)
  })

  // DELETE /households/:id/budget-years/:yearId — delete a simulation or current/future retired regular year
  fastify.delete('/households/:id/budget-years/:yearId', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, yearId } = request.params as { id: string; yearId: string }
    const { sub: userId, role } = request.user

    const isAdmin = await assertHouseholdAdmin(householdId, userId, role)
    if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' })

    const target = await prisma.budgetYear.findFirst({ where: { id: yearId, householdId } })
    if (!target) return reply.status(404).send({ error: 'Budget year not found' })
    if (!canDeleteBudgetYear(target)) {
      return reply.status(400).send({
        error: 'Only simulations or current/future retired budget years can be deleted',
        code: 'BUDGET_YEAR_NOT_DELETABLE',
      })
    }

    await prisma.$transaction(async (tx) => {
      await deleteBudgetYearWithDependencies(tx, yearId)
    })

    return reply.status(204).send()
  })
}
