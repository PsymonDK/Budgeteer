import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyInBase, activeMonthCount } from '../lib/calculations'
import { resolveSaveRate, BASE_CURRENCY } from '../lib/currency'
import { assertBudgetYearAccess, findUsableCategory, validateAccountAccess, validateOwnership } from '../lib/ownership'
import { recalculateTransfer } from '../lib/budgetTransfer'

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

const BulkUpdateExpenseSchema = z.object({
  ids: z.array(z.string()).min(1, { message: 'At least one expense ID required' }),
  categoryId: z.string().optional(),
  accountId: z.string().nullable().optional(),
}).refine(
  (d) => d.categoryId !== undefined || d.accountId !== undefined,
  { message: 'At least one field to update is required' }
)

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

    const result = expenses.map((e) => {
      const months = activeMonthCount(e.startMonth, e.endMonth)
      const monthlyWhenActive = new Decimal(e.monthlyEquivalent.toString()).mul(12).div(months).toDecimalPlaces(2)
      const amountInBase = new Decimal(e.amount.toString()).mul(new Decimal(e.rateUsed?.toString() ?? '1')).toDecimalPlaces(2)
      return { ...e, monthlyWhenActive: monthlyWhenActive.toString(), amountInBase: amountInBase.toString() }
    })

    return reply.send(result)
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
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const { label, amount, frequency, categoryId, frequencyPeriod, startMonth, endMonth, notes, currencyCode, ownership, ownedByUserId, customSplits, accountId } = result.data

    const category = await findUsableCategory(categoryId, budgetYear.householdId, 'EXPENSE')
    if (!category) return reply.status(400).send({ error: 'Category not found' })

    if (accountId) {
      const accountError = await validateAccountAccess(accountId, budgetYear.householdId, userId)
      if (accountError) return reply.status(400).send({ error: accountError })
    }

    const ownershipError = await validateOwnership(ownership, ownedByUserId, customSplits, budgetYear.householdId)
    if (ownershipError) return reply.status(400).send({ error: ownershipError })

    const currency = currencyCode ? currencyCode.toUpperCase() : BASE_CURRENCY
    const resolved = await resolveSaveRate(currency)
    if (!resolved) return reply.status(400).send({ error: `No exchange rate found for ${currency}` })
    const { rate } = resolved

    const monthlyEquivalent = calcMonthlyInBase(amount, rate, frequency, startMonth ?? null, endMonth ?? null)

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
          rateUsed: currency !== BASE_CURRENCY ? rate : null,
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

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
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
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } })
    if (!existing || existing.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Expense not found' })
    }

    const { amount, frequency, categoryId, currencyCode, ownership, ownedByUserId, customSplits, startMonth, endMonth, accountId, ...rest } = result.data

    if (categoryId) {
      const category = await findUsableCategory(categoryId, budgetYear.householdId, 'EXPENSE', existing.categoryId)
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

    if (accountId) {
      const accountError = await validateAccountAccess(accountId, budgetYear.householdId, userId)
      if (accountError) return reply.status(400).send({ error: accountError })
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

    // Determine currency and rate — a locked rate is kept only while the currency is unchanged
    const newCurrency = currencyCode ? currencyCode.toUpperCase()
      : (existing.currencyCode ?? BASE_CURRENCY)
    const resolved = await resolveSaveRate(newCurrency, existing)
    if (!resolved) return reply.status(400).send({ error: `No exchange rate found for ${newCurrency}` })
    const { rate } = resolved

    const newAmount = amount !== undefined ? new Decimal(amount) : new Decimal(existing.amount.toString())
    const newFrequency = frequency ?? existing.frequency
    const newStartMonth = startMonth !== undefined ? (startMonth ?? null) : existing.startMonth
    const newEndMonth = endMonth !== undefined ? (endMonth ?? null) : existing.endMonth
    const monthlyEquivalent = calcMonthlyInBase(newAmount, rate, newFrequency, newStartMonth, newEndMonth)

    const expense = await prisma.$transaction(async (tx) => {
      // Replace custom splits only when the request touches ownership; a label-only
      // edit must not wipe an existing custom split
      const touchesOwnership = ownership !== undefined || customSplits !== undefined
      if (touchesOwnership) await tx.expenseCustomSplit.deleteMany({ where: { expenseId } })

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
          originalAmount: newCurrency !== BASE_CURRENCY ? newAmount : null,
          rateUsed: newCurrency !== BASE_CURRENCY ? rate : null,
          rateDate: newCurrency !== BASE_CURRENCY ? resolved.rateDate : null,
          ...(accountId !== undefined && { accountId: accountId ?? null }),
        },
        include: expenseInclude,
      })

      if (touchesOwnership && newOwnership === 'CUSTOM' && customSplits?.length) {
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

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    return reply.send(expense)
  })

  // PATCH /budget-years/:id/expenses/bulk
  fastify.patch('/budget-years/:id/expenses/bulk', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = BulkUpdateExpenseSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const { ids, categoryId, accountId } = result.data

    if (categoryId !== undefined) {
      const category = await findUsableCategory(categoryId, budgetYear.householdId, 'EXPENSE')
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

    if (accountId !== undefined && accountId !== null) {
      const accountError = await validateAccountAccess(accountId, budgetYear.householdId, userId)
      if (accountError) return reply.status(400).send({ error: accountError })
    }

    const { count } = await prisma.expense.updateMany({
      where: { id: { in: ids }, budgetYearId: id },
      data: {
        ...(categoryId !== undefined && { categoryId }),
        ...(accountId !== undefined && { accountId }),
      },
    })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    return reply.send({ updated: count })
  })

  // DELETE /budget-years/:id/expenses/:expenseId
  fastify.delete('/budget-years/:id/expenses/:expenseId', { preHandler: authenticate }, async (request, reply) => {
    const { id, expenseId } = request.params as { id: string; expenseId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })
    if (budgetYear.status === 'RETIRED') return reply.status(400).send({ error: 'Retired budget years are read-only' })

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } })
    if (!existing || existing.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Expense not found' })
    }

    // Moves to the household trash (restorable); never hard-deleted
    await prisma.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date(), deletedByUserId: userId } })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    return reply.status(204).send()
  })
}
