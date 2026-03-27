import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent } from '../lib/calculations'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'
import { calcIncomeForYear, getIncomeReferenceDate } from '../lib/incomeCalc'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CustomSplitSchema = z.object({
  userId: z.string(),
  pct: z.number().min(0).max(100),
})

const CreateSavingsSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  notes: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
  ownership: z.enum(['SHARED', 'INDIVIDUAL', 'CUSTOM']).default('SHARED'),
  ownedByUserId: z.string().nullable().optional(),
  categoryId: z.string().optional(),
  customSplits: z.array(CustomSplitSchema).optional(),
})

const UpdateSavingsSchema = CreateSavingsSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const savingsInclude = {
  category: { select: { id: true, name: true, icon: true, categoryType: true } },
  ownedBy: { select: { id: true, name: true } },
  customSplits: { include: { user: { select: { id: true, name: true } } } },
} as const

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

async function assertHouseholdMember(householdId: string, userId: string) {
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
  return member !== null
}

async function validateOwnership(
  ownership: 'SHARED' | 'INDIVIDUAL' | 'CUSTOM',
  ownedByUserId: string | null | undefined,
  customSplits: { userId: string; pct: number }[] | undefined,
  householdId: string,
): Promise<string | null> {
  if (ownership === 'SHARED') return null

  if (ownership === 'INDIVIDUAL') {
    if (!ownedByUserId) return 'ownedByUserId is required for INDIVIDUAL ownership'
    const isMember = await assertHouseholdMember(householdId, ownedByUserId)
    if (!isMember) return 'Assigned user is not a member of this household'
    return null
  }

  // CUSTOM
  if (!customSplits || customSplits.length === 0) {
    return 'customSplits are required for CUSTOM ownership'
  }
  for (const split of customSplits) {
    const isMember = await assertHouseholdMember(householdId, split.userId)
    if (!isMember) return `User ${split.userId} is not a member of this household`
  }
  const total = customSplits.reduce((s, c) => s + c.pct, 0)
  if (Math.abs(total - 100) > 0.01) {
    return `Custom split percentages must sum to 100 (got ${total.toFixed(2)})`
  }
  return null
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
      include: savingsInclude,
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

    const { label, amount, frequency, notes, currencyCode, ownership, ownedByUserId, categoryId, customSplits } = result.data

    const ownershipError = await validateOwnership(ownership, ownedByUserId, customSplits, budgetYear.householdId)
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    const currency = currencyCode ? currencyCode.toUpperCase() : BASE_CURRENCY
    const rate = currency === BASE_CURRENCY ? 1 : await getLatestRate(currency)
    if (rate === null) return reply.status(400).send({ error: `No exchange rate found for ${currency}` })

    const amountInBase = amount * rate
    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amountInBase), frequency)

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.savingsEntry.create({
        data: {
          budgetYearId: id,
          label,
          amount: new Decimal(amount),
          frequency,
          monthlyEquivalent,
          notes,
          currencyCode: currency !== BASE_CURRENCY ? currency : null,
          originalAmount: currency !== BASE_CURRENCY ? new Decimal(amount) : null,
          rateUsed: currency !== BASE_CURRENCY ? new Decimal(rate) : null,
          ownership,
          ownedByUserId: ownership === 'INDIVIDUAL' ? (ownedByUserId ?? null) : null,
          categoryId: categoryId ?? null,
        },
        include: savingsInclude,
      })

      if (ownership === 'CUSTOM' && customSplits?.length) {
        await tx.savingsCustomSplit.createMany({
          data: customSplits.map((s) => ({
            savingsEntryId: created.id,
            userId: s.userId,
            pct: new Decimal(s.pct),
          })),
        })
        return tx.savingsEntry.findUniqueOrThrow({ where: { id: created.id }, include: savingsInclude })
      }

      return created
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

    const { ownership, ownedByUserId, categoryId, customSplits, ...data } = result.data

    const newOwnership = ownership ?? existing.ownership
    const newOwnedByUserId = ownedByUserId !== undefined ? ownedByUserId : existing.ownedByUserId

    const ownershipError = await validateOwnership(
      newOwnership,
      newOwnedByUserId,
      customSplits,
      budgetYear.householdId,
    )
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    const newCurrency = data.currencyCode ? data.currencyCode.toUpperCase()
      : (existing.currencyCode ?? BASE_CURRENCY)
    let rate: number
    if (newCurrency === BASE_CURRENCY) {
      rate = 1
    } else if (existing.rateDate && existing.rateUsed) {
      rate = parseFloat(existing.rateUsed.toString())
    } else {
      const fetched = await getLatestRate(newCurrency)
      if (fetched === null) return reply.status(400).send({ error: `No exchange rate found for ${newCurrency}` })
      rate = fetched
    }

    const newAmount = data.amount !== undefined ? data.amount : parseFloat(existing.amount.toString())
    const newFrequency = data.frequency ?? existing.frequency
    const amountInBase = newAmount * rate
    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amountInBase), newFrequency)

    const updated = await prisma.$transaction(async (tx) => {
      // Always replace custom splits when ownership fields are touched
      await tx.savingsCustomSplit.deleteMany({ where: { savingsEntryId: entryId } })

      const savedEntry = await tx.savingsEntry.update({
        where: { id: entryId },
        data: {
          label: data.label,
          amount: new Decimal(newAmount),
          frequency: newFrequency,
          monthlyEquivalent,
          notes: data.notes,
          currencyCode: newCurrency !== BASE_CURRENCY ? newCurrency : null,
          originalAmount: newCurrency !== BASE_CURRENCY ? new Decimal(newAmount) : null,
          rateUsed: newCurrency !== BASE_CURRENCY ? new Decimal(rate) : null,
          ownership: newOwnership,
          ownedByUserId: newOwnership === 'INDIVIDUAL' ? (newOwnedByUserId ?? null) : null,
          ...(categoryId !== undefined && { categoryId: categoryId ?? null }),
        },
        include: savingsInclude,
      })

      if (newOwnership === 'CUSTOM' && customSplits?.length) {
        await tx.savingsCustomSplit.createMany({
          data: customSplits.map((s) => ({
            savingsEntryId: entryId,
            userId: s.userId,
            pct: new Decimal(s.pct),
          })),
        })
        return tx.savingsEntry.findUniqueOrThrow({ where: { id: entryId }, include: savingsInclude })
      }

      return savedEntry
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
        const refDate = getIncomeReferenceDate(y.year, y.status)
        const incomeResult = await calcIncomeForYear(y.id, refDate)
        const income = incomeResult.totalMonthlyNet
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
