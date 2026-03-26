import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent } from '../lib/calculations'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CustomSplitSchema = z.object({
  userId: z.string(),
  pct: z.number().min(0).max(100),
})

const CreateExpenseSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  categoryId: z.string(),
  frequencyPeriod: z.string().optional(),
  notes: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
  ownership: z.enum(['SHARED', 'INDIVIDUAL', 'CUSTOM']).default('SHARED'),
  ownedByUserId: z.string().nullable().optional(),
  customSplits: z.array(CustomSplitSchema).optional(),
})

const UpdateExpenseSchema = CreateExpenseSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const expenseInclude = {
  category: { select: { id: true, name: true, icon: true, isSystemWide: true, categoryType: true } },
  ownedBy: { select: { id: true, name: true } },
  customSplits: { include: { user: { select: { id: true, name: true } } } },
} as const

// Verify that a user is a member of a household
async function assertHouseholdMember(householdId: string, userId: string) {
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
  return member !== null
}

// Verify the caller is a member of the household that owns the budget year
async function assertBudgetYearAccess(budgetYearId: string, userId: string, systemAdmin: boolean) {
  const budgetYear = await prisma.budgetYear.findUnique({
    where: { id: budgetYearId },
    include: {
      household: {
        include: { members: { where: { userId } } },
      },
    },
  })
  if (!budgetYear) return null
  if (!systemAdmin && budgetYear.household.members.length === 0) return null
  return budgetYear
}

type OwnershipInput = {
  ownership: 'SHARED' | 'INDIVIDUAL' | 'CUSTOM'
  ownedByUserId?: string | null
  customSplits?: { userId: string; pct: number }[]
}

async function validateOwnership(
  ownership: OwnershipInput['ownership'],
  ownedByUserId: string | null | undefined,
  customSplits: OwnershipInput['customSplits'],
  householdId: string,
): Promise<string | null> {
  if (ownership === 'SHARED') {
    return null
  }
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

export async function expenseRoutes(fastify: FastifyInstance) {
  // GET /budget-years/:id/expenses
  fastify.get('/budget-years/:id/expenses', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const expenses = await prisma.expense.findMany({
      where: { budgetYearId: id },
      include: expenseInclude,
      orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
    })

    return reply.send(expenses)
  })

  // POST /budget-years/:id/expenses
  fastify.post('/budget-years/:id/expenses', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = CreateExpenseSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const { label, amount, frequency, categoryId, frequencyPeriod, notes, currencyCode, ownership, ownedByUserId, customSplits } = result.data

    const category = await prisma.category.findUnique({ where: { id: categoryId } })
    if (!category) return reply.status(400).send({ error: 'Category not found' })

    const ownershipError = await validateOwnership(ownership, ownedByUserId, customSplits, budgetYear.householdId)
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    const currency = currencyCode ? currencyCode.toUpperCase() : BASE_CURRENCY
    const rate = currency === BASE_CURRENCY ? 1 : await getLatestRate(currency)
    if (rate === null) return reply.status(400).send({ error: `No exchange rate found for ${currency}` })

    const amountInBase = amount * rate
    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amountInBase), frequency)

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          budgetYearId: id,
          label,
          amount: new Decimal(amount),
          frequency,
          categoryId,
          frequencyPeriod: frequencyPeriod ?? null,
          notes: notes ?? null,
          monthlyEquivalent,
          currencyCode: currency !== BASE_CURRENCY ? currency : null,
          originalAmount: currency !== BASE_CURRENCY ? new Decimal(amount) : null,
          rateUsed: currency !== BASE_CURRENCY ? new Decimal(rate) : null,
          ownership,
          ownedByUserId: ownership === 'INDIVIDUAL' ? (ownedByUserId ?? null) : null,
        },
        include: expenseInclude,
      })

      if (ownership === 'CUSTOM' && customSplits?.length) {
        await tx.expenseCustomSplit.createMany({
          data: customSplits.map((s) => ({
            expenseId: created.id,
            userId: s.userId,
            pct: new Decimal(s.pct),
          })),
        })
        return tx.expense.findUniqueOrThrow({ where: { id: created.id }, include: expenseInclude })
      }

      return created
    })

    return reply.status(201).send(expense)
  })

  // PUT /budget-years/:id/expenses/:expenseId
  fastify.put('/budget-years/:id/expenses/:expenseId', { preHandler: authenticate }, async (request, reply) => {
    const { id, expenseId } = request.params as { id: string; expenseId: string }
    const { sub: userId, role } = request.user

    const result = UpdateExpenseSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } })
    if (!existing || existing.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Expense not found' })
    }

    const { amount, frequency, categoryId, currencyCode, ownership, ownedByUserId, customSplits, ...rest } = result.data

    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } })
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

    const newOwnership = ownership ?? existing.ownership
    const newOwnedByUserId = ownedByUserId !== undefined ? ownedByUserId : existing.ownedByUserId

    const ownershipError = await validateOwnership(
      newOwnership,
      newOwnedByUserId,
      customSplits,
      budgetYear.householdId,
    )
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    // Determine currency and rate — respect locked rate if rateDate is set
    const newCurrency = currencyCode ? currencyCode.toUpperCase()
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

    const newAmount = amount !== undefined ? amount : parseFloat(existing.amount.toString())
    const newFrequency = frequency ?? existing.frequency
    const amountInBase = newAmount * rate
    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amountInBase), newFrequency)

    const expense = await prisma.$transaction(async (tx) => {
      // Always replace custom splits when ownership fields are touched
      await tx.expenseCustomSplit.deleteMany({ where: { expenseId } })

      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: {
          ...rest,
          ...(amount !== undefined && { amount: new Decimal(amount) }),
          ...(frequency !== undefined && { frequency }),
          ...(categoryId !== undefined && { categoryId }),
          ownership: newOwnership,
          ownedByUserId: newOwnership === 'INDIVIDUAL' ? (newOwnedByUserId ?? null) : null,
          monthlyEquivalent,
          currencyCode: newCurrency !== BASE_CURRENCY ? newCurrency : null,
          originalAmount: newCurrency !== BASE_CURRENCY ? new Decimal(newAmount) : null,
          rateUsed: newCurrency !== BASE_CURRENCY ? new Decimal(rate) : null,
        },
        include: expenseInclude,
      })

      if (newOwnership === 'CUSTOM' && customSplits?.length) {
        await tx.expenseCustomSplit.createMany({
          data: customSplits.map((s) => ({
            expenseId,
            userId: s.userId,
            pct: new Decimal(s.pct),
          })),
        })
        return tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: expenseInclude })
      }

      return updated
    })

    return reply.send(expense)
  })

  // DELETE /budget-years/:id/expenses/:expenseId
  fastify.delete('/budget-years/:id/expenses/:expenseId', { preHandler: authenticate }, async (request, reply) => {
    const { id, expenseId } = request.params as { id: string; expenseId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } })
    if (!existing || existing.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Expense not found' })
    }

    await prisma.expense.delete({ where: { id: expenseId } })

    return reply.status(204).send()
  })
}
