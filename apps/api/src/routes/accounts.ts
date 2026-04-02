import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertBudgetYearAccess } from '../lib/ownership'

const AccountTypeEnum = z.enum(['BANK', 'CREDIT_CARD', 'MOBILE_PAY'])

const CreateAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: AccountTypeEnum,
})

const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: AccountTypeEnum.optional(),
  isActive: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })

const accountInclude = {
  _count: { select: { expenses: true, savingsEntries: true } },
} as const

async function getHouseholdMembership(householdId: string, userId: string) {
  return prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
}

export async function accountRoutes(fastify: FastifyInstance) {
  // ── Personal accounts ─────────────────────────────────────────────────────

  // GET /users/me/accounts
  fastify.get('/users/me/accounts', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user

    const accounts = await prisma.account.findMany({
      where: { ownedByUserId: userId },
      include: accountInclude,
      orderBy: { name: 'asc' },
    })

    return reply.send(accounts)
  })

  // POST /users/me/accounts
  fastify.post('/users/me/accounts', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user

    const result = CreateAccountSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const account = await prisma.account.create({
      data: {
        name: result.data.name,
        type: result.data.type,
        ownedByUserId: userId,
        householdId: null,
      },
      include: accountInclude,
    })

    return reply.status(201).send(account)
  })

  // PUT /users/me/accounts/:id
  fastify.put('/users/me/accounts/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId } = request.user

    const existing = await prisma.account.findUnique({ where: { id } })
    if (!existing || existing.ownedByUserId !== userId) {
      return reply.status(404).send({ error: 'Account not found' })
    }

    const result = UpdateAccountSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const account = await prisma.account.update({
      where: { id },
      data: result.data,
      include: accountInclude,
    })

    return reply.send(account)
  })

  // DELETE /users/me/accounts/:id
  fastify.delete('/users/me/accounts/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId } = request.user

    const existing = await prisma.account.findUnique({ where: { id }, include: accountInclude })
    if (!existing || existing.ownedByUserId !== userId) {
      return reply.status(404).send({ error: 'Account not found' })
    }

    if (existing._count.expenses > 0 || existing._count.savingsEntries > 0) {
      return reply.status(409).send({ error: 'This account has associated entries. Remove them before deleting.' })
    }

    await prisma.account.delete({ where: { id } })

    return reply.status(204).send()
  })

  // ── Household accounts ────────────────────────────────────────────────────

  // GET /households/:id/accounts — any member
  fastify.get('/households/:id/accounts', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const membership = await getHouseholdMembership(householdId, userId)
    if (!membership && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const accounts = await prisma.account.findMany({
      where: { householdId },
      include: accountInclude,
      orderBy: { name: 'asc' },
    })

    return reply.send(accounts)
  })

  // POST /households/:id/accounts — admin only
  fastify.post('/households/:id/accounts', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const membership = await getHouseholdMembership(householdId, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const result = CreateAccountSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const account = await prisma.account.create({
      data: {
        name: result.data.name,
        type: result.data.type,
        householdId,
        ownedByUserId: null,
      },
      include: accountInclude,
    })

    return reply.status(201).send(account)
  })

  // PUT /households/:id/accounts/:accountId — admin only
  fastify.put('/households/:id/accounts/:accountId', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, accountId } = request.params as { id: string; accountId: string }
    const { sub: userId, role } = request.user

    const membership = await getHouseholdMembership(householdId, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const existing = await prisma.account.findUnique({ where: { id: accountId } })
    if (!existing || existing.householdId !== householdId) {
      return reply.status(404).send({ error: 'Account not found' })
    }

    const result = UpdateAccountSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const account = await prisma.account.update({
      where: { id: accountId },
      data: result.data,
      include: accountInclude,
    })

    return reply.send(account)
  })

  // DELETE /households/:id/accounts/:accountId — admin only
  fastify.delete('/households/:id/accounts/:accountId', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, accountId } = request.params as { id: string; accountId: string }
    const { sub: userId, role } = request.user

    const membership = await getHouseholdMembership(householdId, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const existing = await prisma.account.findUnique({ where: { id: accountId }, include: accountInclude })
    if (!existing || existing.householdId !== householdId) {
      return reply.status(404).send({ error: 'Account not found' })
    }

    if (existing._count.expenses > 0 || existing._count.savingsEntries > 0) {
      return reply.status(409).send({ error: 'This account has associated entries. Remove them before deleting.' })
    }

    await prisma.account.delete({ where: { id: accountId } })

    return reply.status(204).send()
  })

  // ── Combined endpoint for forms ───────────────────────────────────────────

  // GET /budget-years/:id/accounts
  // Returns { personal: Account[], household: Account[] } for the expense/savings form dropdown.
  // personal = accounts owned by the calling user
  // household = accounts owned by the household that owns this budget year
  fastify.get('/budget-years/:id/accounts', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const [personal, household] = await Promise.all([
      prisma.account.findMany({
        where: { ownedByUserId: userId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true, isActive: true },
      }),
      prisma.account.findMany({
        where: { householdId: budgetYear.householdId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true, isActive: true },
      }),
    ])

    return reply.send({ personal, household })
  })
}
