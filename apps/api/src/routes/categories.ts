import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  householdId: z.string(),
  icon: z.string().optional(),
})

const DeleteCategorySchema = z
  .object({ replacementId: z.string().optional() })
  .optional()

const categorySelect = {
  id: true,
  name: true,
  icon: true,
  isSystemWide: true,
  householdId: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { expenses: true } },
} as const

export async function categoryRoutes(fastify: FastifyInstance) {
  // GET /categories?householdId=:id
  // System-wide categories always returned.
  // If householdId given: also includes that household's custom categories.
  // System admin with no householdId: all categories across system.
  fastify.get('/categories', { preHandler: authenticate }, async (request, reply) => {
    const { householdId } = request.query as { householdId?: string }
    const { role } = request.user

    let where = {}

    if (householdId) {
      // Verify requester is a member of this household (or system admin)
      if (role !== 'SYSTEM_ADMIN') {
        const membership = await prisma.householdMember.findUnique({
          where: { householdId_userId: { householdId, userId: request.user.sub } },
        })
        if (!membership) return reply.status(403).send({ error: 'Forbidden' })
      }
      where = { OR: [{ isSystemWide: true }, { householdId }] }
    } else if (role === 'SYSTEM_ADMIN') {
      where = {} // all categories
    } else {
      where = { isSystemWide: true }
    }

    const categories = await prisma.expenseCategory.findMany({
      where,
      select: categorySelect,
      orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
    })

    return reply.send(categories)
  })

  // POST /categories — create a custom category scoped to a household
  fastify.post('/categories', { preHandler: authenticate }, async (request, reply) => {
    const result = CreateCategorySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }
    const { name, householdId, icon } = result.data
    const { sub: userId, role } = request.user

    // Requester must be a member of the household
    if (role !== 'SYSTEM_ADMIN') {
      const membership = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    }

    // Name must be unique within the household
    const duplicate = await prisma.expenseCategory.findFirst({
      where: { householdId, name: { equals: name, mode: 'insensitive' } },
    })
    if (duplicate) {
      return reply.status(409).send({ error: 'A category with this name already exists in this household' })
    }

    const category = await prisma.expenseCategory.create({
      data: { name, householdId, icon, isSystemWide: false, createdByUserId: userId },
      select: categorySelect,
    })

    // Warn if name matches an existing system-wide category
    const systemMatch = await prisma.expenseCategory.findFirst({
      where: { isSystemWide: true, name: { equals: name, mode: 'insensitive' } },
    })

    return reply.status(201).send({
      ...category,
      ...(systemMatch ? { warning: 'A system-wide category with this name already exists' } : {}),
    })
  })

  // POST /categories/:id/promote — make a custom category system-wide (system admin only)
  fastify.post('/categories/:id/promote', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const category = await prisma.expenseCategory.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ error: 'Category not found' })
    if (category.isSystemWide) return reply.status(400).send({ error: 'Category is already system-wide' })

    const promoted = await prisma.expenseCategory.update({
      where: { id },
      data: { isSystemWide: true, householdId: null },
      select: categorySelect,
    })

    return reply.send(promoted)
  })

  // DELETE /categories/:id
  // Body { replacementId? } — if provided, reassigns all expenses before deleting.
  // Without replacement: fails with 409 if category is in use.
  fastify.delete('/categories/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const bodyResult = DeleteCategorySchema.safeParse(request.body)
    const replacementId = bodyResult.success ? bodyResult.data?.replacementId : undefined

    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      select: { ...categorySelect, householdId: true, isSystemWide: true },
    })
    if (!category) return reply.status(404).send({ error: 'Category not found' })

    // System-wide categories: system admin only
    if (category.isSystemWide && role !== 'SYSTEM_ADMIN') {
      return reply.status(403).send({ error: 'Only a system admin can delete system-wide categories' })
    }

    // Custom categories: household admin or system admin
    if (!category.isSystemWide && role !== 'SYSTEM_ADMIN') {
      const membership = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId: category.householdId!, userId } },
      })
      if (membership?.role !== 'ADMIN') {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    const expenseCount = category._count.expenses

    if (expenseCount > 0) {
      if (!replacementId) {
        return reply.status(409).send({
          error: 'Category is in use',
          count: expenseCount,
          message: 'Provide a replacementId to reassign expenses before deletion',
        })
      }

      // Validate replacement exists
      const replacement = await prisma.expenseCategory.findUnique({ where: { id: replacementId } })
      if (!replacement) return reply.status(400).send({ error: 'Replacement category not found' })

      // Reassign all expenses then delete in a transaction
      await prisma.$transaction([
        prisma.expense.updateMany({ where: { categoryId: id }, data: { categoryId: replacementId } }),
        prisma.expenseCategory.delete({ where: { id } }),
      ])
    } else {
      await prisma.expenseCategory.delete({ where: { id } })
    }

    return reply.status(204).send()
  })
}
