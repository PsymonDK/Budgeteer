import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcMonthlyEquivalent } from '../lib/calculations'

const FrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'])

const CreateExpenseSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencyEnum,
  categoryId: z.string(),
  frequencyPeriod: z.string().optional(),
  notes: z.string().optional(),
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

    const { label, amount, frequency, categoryId, frequencyPeriod, notes } = result.data

    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } })
    if (!category) return reply.status(400).send({ error: 'Category not found' })

    const monthlyEquivalent = calcMonthlyEquivalent(new Decimal(amount), frequency)

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

    const { amount, frequency, categoryId, ...rest } = result.data

    // Recalculate monthly equivalent if amount or frequency changed
    const newAmount = amount !== undefined ? new Decimal(amount) : existing.amount
    const newFrequency = frequency ?? existing.frequency
    const monthlyEquivalent = calcMonthlyEquivalent(newAmount, newFrequency)

    if (categoryId) {
      const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } })
      if (!category) return reply.status(400).send({ error: 'Category not found' })
    }

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...rest,
        ...(amount !== undefined && { amount: newAmount }),
        ...(frequency !== undefined && { frequency }),
        ...(categoryId !== undefined && { categoryId }),
        monthlyEquivalent,
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
