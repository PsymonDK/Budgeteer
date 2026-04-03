import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertBudgetYearAccess } from '../lib/ownership'
import { recalculateTransfer } from '../lib/budgetTransfer'

const MarkPaidSchema = z.object({
  actualAmount: z.number().positive(),
})

export async function budgetTransferRoutes(fastify: FastifyInstance) {
  // GET /budget-years/:id/transfers
  fastify.get('/budget-years/:id/transfers', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const transfers = await prisma.budgetTransfer.findMany({
      where: { budgetYearId: id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })

    return reply.send(transfers)
  })

  // PATCH /budget-years/:id/transfers/:transferId/mark-paid
  fastify.patch('/budget-years/:id/transfers/:transferId/mark-paid', { preHandler: authenticate }, async (request, reply) => {
    const { id, transferId } = request.params as { id: string; transferId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const result = MarkPaidSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const transfer = await prisma.budgetTransfer.findUnique({ where: { id: transferId } })
    if (!transfer || transfer.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Transfer not found' })
    }

    const { actualAmount } = result.data
    const calculatedAmount = parseFloat(transfer.calculatedAmount.toString())
    const status = actualAmount === calculatedAmount ? 'PAID' : 'ADJUSTED'

    const updated = await prisma.budgetTransfer.update({
      where: { id: transferId },
      data: {
        actualAmount: new Decimal(actualAmount),
        status,
        paidAt: new Date(),
      },
    })

    recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    return reply.send(updated)
  })

  // PATCH /budget-years/:id/transfers/:transferId/mark-pending
  fastify.patch('/budget-years/:id/transfers/:transferId/mark-pending', { preHandler: authenticate }, async (request, reply) => {
    const { id, transferId } = request.params as { id: string; transferId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const transfer = await prisma.budgetTransfer.findUnique({ where: { id: transferId } })
    if (!transfer || transfer.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Transfer not found' })
    }

    const updated = await prisma.budgetTransfer.update({
      where: { id: transferId },
      data: {
        status: 'PENDING',
        actualAmount: null,
        paidAt: null,
      },
    })

    recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    return reply.send(updated)
  })
}
