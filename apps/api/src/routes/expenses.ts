import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent } from '../lib/calculations'
import { getLatestRate, BASE_CURRENCY } from '../lib/currency'

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CreateExpenseSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  categoryId: z.string(),
  frequencyPeriod: z.string().optional(),
  notes: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
})

const UpdateExpenseSchema = CreateExpenseSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field is required' }
)

const expenseInclude = {
  category: { select: { id: true, name: true, isSystemWide: true } },
} as const

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

    const { label, amount, frequency, categoryId, frequencyPeriod, notes, currencyCode } = result.data

    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } })
    if (!category) return reply.status(400).send({ error: 'Category not found' })

    const currency = currencyCode ? currencyCode.toUpperCase() : BASE_CURRENCY
    const rate = currency === BASE_CURRENCY ? 1 : await getLatestRate(currency)
    if (rate === null) return reply.status(400).send({ error: `No exchange rate found for ${currency}` })

    const amountInBase = amount * rate
    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amountInBase), frequency)

    const expense = await prisma.expense.create({
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
      },
      include: expenseInclude,
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

    const { amount, frequency, categoryId, currencyCode, ...rest } = result.data

    if (categoryId) {
      const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } })
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

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

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...rest,
        ...(amount !== undefined && { amount: new Decimal(amount) }),
        ...(frequency !== undefined && { frequency }),
        ...(categoryId !== undefined && { categoryId }),
        monthlyEquivalent,
        currencyCode: newCurrency !== BASE_CURRENCY ? newCurrency : null,
        originalAmount: newCurrency !== BASE_CURRENCY ? new Decimal(newAmount) : null,
        rateUsed: newCurrency !== BASE_CURRENCY ? new Decimal(rate) : null,
      },
      include: expenseInclude,
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
