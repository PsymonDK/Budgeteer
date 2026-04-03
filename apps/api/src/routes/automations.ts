import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'
import { runAutomation, runAllEnabledAutomations } from '../lib/automations'

export async function automationRoutes(fastify: FastifyInstance) {
  // GET /admin/automations
  fastify.get('/admin/automations', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const automations = await prisma.automation.findMany({
      include: {
        household: { select: { id: true, name: true } },
        _count: { select: { runs: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send(automations)
  })

  // PATCH /admin/automations/:id/toggle
  fastify.patch('/admin/automations/:id/toggle', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const automation = await prisma.automation.findUnique({ where: { id } })
    if (!automation) return reply.status(404).send({ error: 'Automation not found' })

    const updated = await prisma.automation.update({
      where: { id },
      data: { isEnabled: !automation.isEnabled },
    })
    return reply.send(updated)
  })

  // GET /admin/automations/:id/runs
  fastify.get('/admin/automations/:id/runs', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const automation = await prisma.automation.findUnique({ where: { id } })
    if (!automation) return reply.status(404).send({ error: 'Automation not found' })

    const runs = await prisma.automationRun.findMany({
      where: { automationId: id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    })
    return reply.send(runs)
  })

  // POST /admin/automations/:id/trigger
  fastify.post('/admin/automations/:id/trigger', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId } = request.user

    const automation = await prisma.automation.findUnique({ where: { id } })
    if (!automation) return reply.status(404).send({ error: 'Automation not found' })

    await runAutomation(id, 'MANUAL', userId)
    return reply.send({ success: true })
  })

  // POST /admin/automations/trigger-all
  fastify.post('/admin/automations/trigger-all', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { sub: userId } = request.user
    const triggered = await runAllEnabledAutomations('MANUAL', userId)
    return reply.send({ triggered })
  })
}
