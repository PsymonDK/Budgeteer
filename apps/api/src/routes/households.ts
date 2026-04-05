import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'
import { recalculateTransfer } from '../lib/budgetTransfer'

const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
})

const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  autoMarkTransferPaid: z.boolean().optional(),
  budgetModel: z.enum(['AVERAGE', 'FORWARD_LOOKING', 'PAY_NO_PAY']).optional(),
})

const AddMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
})

const UpdateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
})

const memberInclude = {
  user: { select: { id: true, name: true, email: true, isActive: true } },
} as const

// Returns the membership record for userId in householdId, or null if not a member
async function getMembership(householdId: string, userId: string) {
  return prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
}

export async function householdRoutes(fastify: FastifyInstance) {
  // GET /households
  // System admin → all households. Regular user → their own.
  fastify.get('/households', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId, role } = request.user

    const queryResult = z.object({ all: z.enum(['true', 'false']).optional() }).safeParse(request.query)
    if (!queryResult.success) return reply.status(400).send({ error: 'Invalid query parameters' })
    const includeInactive = role === 'SYSTEM_ADMIN' && queryResult.data.all === 'true'
    const activeFilter = includeInactive ? {} : { isActive: true }
    const where = role === 'SYSTEM_ADMIN'
      ? { ...activeFilter }
      : { isActive: true, members: { some: { userId } } }

    const households = await prisma.household.findMany({
      where,
      include: {
        members: { include: memberInclude, orderBy: { joinedAt: 'asc' } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send(
      households.map((h) => ({
        ...h,
        myRole: h.members.find((m) => m.userId === userId)?.role ?? null,
      }))
    )
  })

  // POST /households — any authenticated user can create a household
  fastify.post('/households', { preHandler: authenticate }, async (request, reply) => {
    const result = CreateHouseholdSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { sub: userId } = request.user

    const household = await prisma.household.create({
      data: {
        name: result.data.name,
        members: { create: { userId, role: 'ADMIN' } },
      },
      include: {
        members: { include: memberInclude },
        _count: { select: { members: true } },
      },
    })

    await prisma.automation.create({
      data: {
        key: 'monthly_transfer_snapshot',
        label: 'Monthly budget transfer calculation',
        description: 'Calculates and records the recommended monthly transfer on the 1st of each month',
        schedule: '0 0 1 * *',
        householdId: household.id,
      },
    })

    return reply.status(201).send({ ...household, myRole: 'ADMIN' })
  })

  // GET /households/:id
  fastify.get('/households/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const household = await prisma.household.findUnique({
      where: { id },
      include: {
        members: { include: memberInclude, orderBy: { joinedAt: 'asc' } },
        _count: { select: { members: true } },
      },
    })

    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const isMember = household.members.some((m) => m.userId === userId)
    if (!isMember && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    return reply.send({
      ...household,
      myRole: household.members.find((m) => m.userId === userId)?.role ?? null,
    })
  })

  // PUT /households/:id — household admin only
  fastify.put('/households/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = UpdateHouseholdSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const membership = await getMembership(id, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const { name, autoMarkTransferPaid, budgetModel } = result.data
    const household = await prisma.household.update({
      where: { id },
      data: {
        name,
        ...(autoMarkTransferPaid !== undefined && { autoMarkTransferPaid }),
        ...(budgetModel !== undefined && { budgetModel }),
      },
    })

    // Recalculate transfers whenever budget model changes so the history reflects
    // the new model immediately rather than on the next expense/savings mutation.
    if (budgetModel !== undefined) {
      const activeBY = await prisma.budgetYear.findFirst({
        where: { householdId: id, status: { in: ['ACTIVE', 'FUTURE'] } },
        orderBy: [{ status: 'asc' }, { year: 'asc' }],
      })
      if (activeBY) {
        recalculateTransfer(activeBY.id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed after budgetModel change'))
      }
    }

    return reply.send(household)
  })

  // POST /households/:id/members — household admin only
  fastify.post('/households/:id/members', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const result = AddMemberSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const membership = await getMembership(id, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const targetUser = await prisma.user.findUnique({ where: { id: result.data.userId } })
    if (!targetUser || !targetUser.isActive) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const existing = await getMembership(id, result.data.userId)
    if (existing) {
      return reply.status(409).send({ error: 'User is already a member of this household' })
    }

    const newMember = await prisma.householdMember.create({
      data: { householdId: id, userId: result.data.userId, role: result.data.role },
      include: memberInclude,
    })

    return reply.status(201).send(newMember)
  })

  // PUT /households/:id/members/:memberId — update role (household admin only)
  fastify.put('/households/:id/members/:memberId', { preHandler: authenticate }, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string }
    const { sub: userId, role } = request.user

    const result = UpdateMemberSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const callerMembership = await getMembership(id, userId)
    if (callerMembership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    // Prevent removing the last admin
    if (result.data.role === 'MEMBER') {
      const adminCount = await prisma.householdMember.count({ where: { householdId: id, role: 'ADMIN' } })
      const target = await getMembership(id, memberId)
      if (target?.role === 'ADMIN' && adminCount <= 1) {
        return reply.status(400).send({ error: 'Household must have at least one admin' })
      }
    }

    const updated = await prisma.householdMember.update({
      where: { householdId_userId: { householdId: id, userId: memberId } },
      data: { role: result.data.role },
      include: memberInclude,
    })

    return reply.send(updated)
  })

  // DELETE /households/:id/members/:memberId — household admin only
  fastify.delete('/households/:id/members/:memberId', { preHandler: authenticate }, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string }
    const { sub: userId, role } = request.user

    const callerMembership = await getMembership(id, userId)
    if (callerMembership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const target = await getMembership(id, memberId)
    if (!target) return reply.status(404).send({ error: 'Member not found' })

    if (target.role === 'ADMIN') {
      const adminCount = await prisma.householdMember.count({ where: { householdId: id, role: 'ADMIN' } })
      if (adminCount <= 1) {
        return reply.status(400).send({ error: 'Cannot remove the last admin from a household' })
      }
    }

    // Income allocations are on IncomeEntry — they are preserved automatically
    await prisma.householdMember.delete({
      where: { householdId_userId: { householdId: id, userId: memberId } },
    })

    return reply.status(204).send()
  })

  // PUT /households/:id/deactivate — household admin only (soft delete)
  fastify.put('/households/:id/deactivate', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const membership = await getMembership(id, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const household = await prisma.household.update({ where: { id }, data: { isActive: false } })
    return reply.send(household)
  })

  // PUT /households/:id/reactivate — household admin only
  fastify.put('/households/:id/reactivate', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const membership = await getMembership(id, userId)
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const household = await prisma.household.update({ where: { id }, data: { isActive: true } })
    return reply.send(household)
  })

  // DELETE /households/:id — system admin only (hard delete)
  fastify.delete('/households/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const activeBudgetYear = await prisma.budgetYear.findFirst({
      where: { householdId: id, status: 'ACTIVE' },
    })
    if (activeBudgetYear) {
      return reply.status(409).send({ error: 'Cannot delete a household with an active budget year. Retire or deactivate it first.' })
    }

    await prisma.household.delete({ where: { id } })
    return reply.status(204).send()
  })
}
