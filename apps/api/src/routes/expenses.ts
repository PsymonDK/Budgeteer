import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent, calcAnnualAverage } from '../lib/calculations'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'
import { assertBudgetYearAccess, validateOwnership } from '../lib/ownership'
import { toNum } from '../lib/decimal'

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CustomSplitSchema = z.object({
  userId: z.string(),
  pct: z.number().min(0).max(100),
})

const ExpenseBaseSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  categoryId: z.string(),
  frequencyPeriod: z.string().optional(),
  startMonth: z.number().int().min(1).max(12).nullable().optional(),
  endMonth: z.number().int().min(1).max(12).nullable().optional(),
  notes: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
  ownership: z.enum(['SHARED', 'INDIVIDUAL', 'CUSTOM']).default('SHARED'),
  ownedByUserId: z.string().nullable().optional(),
  customSplits: z.array(CustomSplitSchema).optional(),
  accountId: z.string().nullable().optional(),
})

const monthRangeRefinement = (d: { startMonth?: number | null; endMonth?: number | null }) => {
  if (d.startMonth != null && d.endMonth != null) return d.startMonth <= d.endMonth
  return true
}

const CreateExpenseSchema = ExpenseBaseSchema.refine(monthRangeRefinement, {
  message: 'startMonth must be ≤ endMonth', path: ['endMonth'],
})

const UpdateExpenseSchema = ExpenseBaseSchema.partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })
  .refine(monthRangeRefinement, { message: 'startMonth must be ≤ endMonth', path: ['endMonth'] })

const expenseInclude = {
  category: { select: { id: true, name: true, icon: true, isSystemWide: true, categoryType: true } },
  ownedBy: { select: { id: true, name: true } },
  customSplits: { include: { user: { select: { id: true, name: true } } } },
  account: { select: { id: true, name: true, type: true } },
} as const


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

    const { label, amount, frequency, categoryId, frequencyPeriod, startMonth, endMonth, notes, currencyCode, ownership, ownedByUserId, customSplits, accountId } = result.data

    const category = await prisma.category.findUnique({ where: { id: categoryId } })
    if (!category) return reply.status(400).send({ error: 'Category not found' })

    if (accountId) {
      const acct = await prisma.account.findUnique({ where: { id: accountId } })
      if (!acct || !acct.isActive) return reply.status(400).send({ error: 'Account not found' })
      if (acct.ownedByUserId !== userId && acct.householdId !== budgetYear.householdId)
        return reply.status(400).send({ error: 'Account not accessible' })
    }

    const ownershipError = await validateOwnership(ownership, ownedByUserId, customSplits, budgetYear.householdId)
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    const currency = currencyCode ? currencyCode.toUpperCase() : BASE_CURRENCY
    const rate = currency === BASE_CURRENCY ? 1 : await getLatestRate(currency)
    if (rate === null) return reply.status(400).send({ error: `No exchange rate found for ${currency}` })

    const amountInBase = amount * rate
    const monthlyEquivalent = calcAnnualAverage(
      calcMonthlyEquivalent(new Decimal(amountInBase), frequency),
      startMonth ?? null,
      endMonth ?? null,
    )

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          budgetYearId: id,
          label,
          amount: new Decimal(amount),
          frequency,
          categoryId,
          frequencyPeriod: frequencyPeriod ?? null,
          startMonth: startMonth ?? null,
          endMonth: endMonth ?? null,
          notes: notes ?? null,
          monthlyEquivalent,
          currencyCode: currency !== BASE_CURRENCY ? currency : null,
          originalAmount: currency !== BASE_CURRENCY ? new Decimal(amount) : null,
          rateUsed: currency !== BASE_CURRENCY ? new Decimal(rate) : null,
          ownership,
          ownedByUserId: ownership === 'INDIVIDUAL' ? (ownedByUserId ?? null) : null,
          accountId: accountId ?? null,
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

    const { amount, frequency, categoryId, currencyCode, ownership, ownedByUserId, customSplits, startMonth, endMonth, accountId, ...rest } = result.data

    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } })
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

    if (accountId) {
      const acct = await prisma.account.findUnique({ where: { id: accountId } })
      if (!acct || !acct.isActive) return reply.status(400).send({ error: 'Account not found' })
      if (acct.ownedByUserId !== userId && acct.householdId !== budgetYear.householdId)
        return reply.status(400).send({ error: 'Account not accessible' })
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
      rate = toNum(existing.rateUsed)
    } else {
      const fetched = await getLatestRate(newCurrency)
      if (fetched === null) return reply.status(400).send({ error: `No exchange rate found for ${newCurrency}` })
      rate = fetched
    }

    const newAmount = amount !== undefined ? amount : toNum(existing.amount)
    const newFrequency = frequency ?? existing.frequency
    const newStartMonth = startMonth !== undefined ? (startMonth ?? null) : existing.startMonth
    const newEndMonth = endMonth !== undefined ? (endMonth ?? null) : existing.endMonth
    const amountInBase = newAmount * rate
    const monthlyEquivalent = calcAnnualAverage(
      calcMonthlyEquivalent(new Decimal(amountInBase), newFrequency),
      newStartMonth,
      newEndMonth,
    )

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
          ...(startMonth !== undefined && { startMonth: startMonth ?? null }),
          ...(endMonth !== undefined && { endMonth: endMonth ?? null }),
          ownership: newOwnership,
          ownedByUserId: newOwnership === 'INDIVIDUAL' ? (newOwnedByUserId ?? null) : null,
          monthlyEquivalent,
          currencyCode: newCurrency !== BASE_CURRENCY ? newCurrency : null,
          originalAmount: newCurrency !== BASE_CURRENCY ? new Decimal(newAmount) : null,
          rateUsed: newCurrency !== BASE_CURRENCY ? new Decimal(rate) : null,
          ...(accountId !== undefined && { accountId: accountId ?? null }),
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
