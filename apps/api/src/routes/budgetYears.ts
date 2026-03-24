import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { deriveBudgetStatus } from '../lib/calculations'

const CreateBudgetYearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
})

async function assertHouseholdMember(householdId: string, userId: string) {
  return prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
}

export async function budgetYearRoutes(fastify: FastifyInstance) {
  // GET /households/:id/budget-years
  fastify.get('/households/:id/budget-years', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const member = await assertHouseholdMember(householdId, userId)
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    const years = await prisma.budgetYear.findMany({
      where: { householdId, status: { not: 'SIMULATION' } },
      include: {
        _count: { select: { expenses: true, savingsEntries: true } },
      },
      orderBy: { year: 'desc' },
    })

    return reply.send(years)
  })

  // POST /households/:id/budget-years
  fastify.post('/households/:id/budget-years', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = CreateBudgetYearSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    if (role !== 'SYSTEM_ADMIN') {
      const member = await assertHouseholdMember(householdId, userId)
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

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

    return reply.status(201).send(budgetYear)
  })
}
