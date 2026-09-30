import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { includingTrashed, notDeleted, prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'
import { getActiveMembership } from '../lib/ownership'

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  householdId: z.string(),
  icon: z.string().optional(),
  categoryType: z.enum(['EXPENSE', 'SAVINGS']).default('EXPENSE'),
})

const CreateSystemCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().optional(),
  categoryType: z.enum(['EXPENSE', 'SAVINGS']).default('EXPENSE'),
})

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  icon: z.string().optional(),
})

const DeleteCategorySchema = z
  .object({ replacementId: z.string().optional() })
  .optional()

const CreateSubcategorySchema = z.object({
  name: z.string().min(1).max(100),
  householdId: z.string(),
})

const categorySelect = {
  id: true,
  name: true,
  icon: true,
  categoryType: true,
  isSystemWide: true,
  isActive: true,
  householdId: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { expenses: { where: notDeleted }, savingsEntries: { where: notDeleted } } },
} as const

const subcategorySelect = {
  id: true,
  categoryId: true,
  householdId: true,
  name: true,
  isSystemWide: true,
  isActive: true,
  createdAt: true,
} as const

export async function categoryRoutes(fastify: FastifyInstance) {
  // GET /categories?householdId=:id&type=EXPENSE|SAVINGS
  // System-wide categories always returned (active ones for regular users, all for admins).
  // If householdId given: also includes that household's custom categories.
  // System admin with no householdId: all categories across system.
  // Optional ?type filter restricts to EXPENSE or SAVINGS categories.
  fastify.get('/categories', { preHandler: authenticate }, async (request, reply) => {
    const { householdId, type } = request.query as { householdId?: string; type?: string }
    const { role } = request.user
    const isAdmin = role === 'SYSTEM_ADMIN'

    const typeFilter = type === 'EXPENSE' || type === 'SAVINGS' ? { categoryType: type as 'EXPENSE' | 'SAVINGS' } : {}
    const activeFilter = isAdmin ? {} : { isActive: true }

    let where: Record<string, unknown>

    if (householdId) {
      // Verify requester is a member of this household (or system admin)
      if (!isAdmin) {
        const membership = await getActiveMembership(householdId, request.user.sub)
        if (!membership) return reply.status(403).send({ error: 'Forbidden' })
      }
      where = { ...typeFilter, ...activeFilter, OR: [{ isSystemWide: true }, { householdId }] }
    } else if (isAdmin) {
      where = { ...typeFilter } // all categories (optionally filtered by type)
    } else {
      where = { ...typeFilter, isActive: true, isSystemWide: true }
    }

    const categories = await prisma.category.findMany({
      where,
      select: categorySelect,
      orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
    })

    return reply.send(categories)
  })

  // GET /categories/:id/subcategories?householdId=:id
  fastify.get('/categories/:id/subcategories', { preHandler: authenticate }, async (request, reply) => {
    const { id: categoryId } = request.params as { id: string }
    const { householdId } = request.query as { householdId?: string }
    const { sub: userId, role } = request.user
    if (!householdId) return reply.status(400).send({ error: 'householdId is required' })

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        categoryType: 'EXPENSE',
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
      },
    })
    if (!category) return reply.status(404).send({ error: 'Category not found' })

    if (role !== 'SYSTEM_ADMIN') {
      const membership = await getActiveMembership(householdId, userId)
      if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    }

    const subcategories = await prisma.receiptSubcategory.findMany({
      where: {
        categoryId,
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
      },
      select: subcategorySelect,
      orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
    })

    return reply.send(subcategories)
  })

  // GET /households/:id/receipt-subcategories — visible receipt subcategories grouped by expense category
  fastify.get('/households/:id/receipt-subcategories', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const membership = await getActiveMembership(householdId, userId)
      if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    }

    const subcategories = await prisma.receiptSubcategory.findMany({
      where: {
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
        category: {
          categoryType: 'EXPENSE',
          isActive: true,
          OR: [{ isSystemWide: true }, { householdId }],
        },
      },
      select: subcategorySelect,
      orderBy: [{ isSystemWide: 'desc' }, { name: 'asc' }],
    })

    return reply.send(subcategories)
  })

  // POST /categories/:id/subcategories — create a household receipt subcategory under an expense category
  fastify.post('/categories/:id/subcategories', { preHandler: authenticate }, async (request, reply) => {
    const { id: categoryId } = request.params as { id: string }
    const result = CreateSubcategorySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    }

    const { name, householdId } = result.data
    const { sub: userId, role } = request.user

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        categoryType: 'EXPENSE',
        isActive: true,
        OR: [{ isSystemWide: true }, { householdId }],
      },
    })
    if (!category) return reply.status(404).send({ error: 'Category not found' })

    if (role !== 'SYSTEM_ADMIN') {
      const membership = await getActiveMembership(householdId, userId)
      if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    }

    const duplicate = await prisma.receiptSubcategory.findFirst({
      where: {
        categoryId,
        name: { equals: name, mode: 'insensitive' },
        OR: [{ isSystemWide: true }, { householdId }],
      },
    })
    if (duplicate) {
      return reply.status(409).send({ error: 'A subcategory with this name already exists for this category' })
    }

    const subcategory = await prisma.receiptSubcategory.create({
      data: { categoryId, householdId, name, isSystemWide: false },
      select: subcategorySelect,
    })

    return reply.status(201).send(subcategory)
  })

  // POST /categories — create a custom category scoped to a household
  fastify.post('/categories', { preHandler: authenticate }, async (request, reply) => {
    const result = CreateCategorySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    }
    const { name, householdId, icon, categoryType } = result.data
    const { sub: userId, role } = request.user

    // Requester must be a member of the household
    if (role !== 'SYSTEM_ADMIN') {
      const membership = await getActiveMembership(householdId, userId)
      if (!membership) return reply.status(403).send({ error: 'Forbidden' })
    }

    // Name must be unique within the household for the same type
    const duplicate = await prisma.category.findFirst({
      where: { householdId, categoryType, name: { equals: name, mode: 'insensitive' } },
    })
    if (duplicate) {
      return reply.status(409).send({ error: 'A category with this name already exists in this household' })
    }

    const category = await prisma.category.create({
      data: { name, householdId, icon, categoryType, isSystemWide: false, createdByUserId: userId },
      select: categorySelect,
    })

    // Warn if name matches an existing system-wide category of the same type
    const systemMatch = await prisma.category.findFirst({
      where: { isSystemWide: true, categoryType, name: { equals: name, mode: 'insensitive' } },
    })

    return reply.status(201).send({
      ...category,
      ...(systemMatch ? { warning: 'A system-wide category with this name already exists' } : {}),
    })
  })

  // POST /admin/categories — create a system-wide category (system admin only)
  fastify.post('/admin/categories', { preHandler: requireAdmin }, async (request, reply) => {
    const result = CreateSystemCategorySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    }
    const { name, icon, categoryType } = result.data
    const { sub: userId } = request.user

    const duplicate = await prisma.category.findFirst({
      where: { isSystemWide: true, categoryType, name: { equals: name, mode: 'insensitive' } },
    })
    if (duplicate) {
      return reply.status(409).send({ error: 'A system-wide category with this name already exists' })
    }

    const category = await prisma.category.create({
      data: { name, icon, categoryType, isSystemWide: true, createdByUserId: userId },
      select: categorySelect,
    })

    return reply.status(201).send(category)
  })

  // PATCH /admin/categories/:id — rename or toggle isActive (system admin only)
  fastify.patch('/admin/categories/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const result = UpdateCategorySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    }
    const { name, isActive, icon } = result.data

    const category = await prisma.category.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ error: 'Category not found' })

    if (name && name !== category.name) {
      const duplicate = await prisma.category.findFirst({
        where: {
          isSystemWide: true,
          categoryType: category.categoryType,
          name: { equals: name, mode: 'insensitive' },
          NOT: { id },
        },
      })
      if (duplicate) {
        return reply.status(409).send({ error: 'A system-wide category with this name already exists' })
      }
    }

    const updates: { name?: string; isActive?: boolean; icon?: string } = {}
    if (name !== undefined) updates.name = name
    if (isActive !== undefined) updates.isActive = isActive
    if (icon !== undefined) updates.icon = icon

    const updated = await prisma.category.update({
      where: { id },
      data: updates,
      select: categorySelect,
    })

    return reply.send(updated)
  })

  // POST /categories/:id/promote — make a custom category system-wide (system admin only)
  fastify.post('/categories/:id/promote', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const category = await prisma.category.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ error: 'Category not found' })
    if (category.isSystemWide) return reply.status(400).send({ error: 'Category is already system-wide' })

    const promoted = await prisma.category.update({
      where: { id },
      data: { isSystemWide: true, householdId: null },
      select: categorySelect,
    })

    return reply.send(promoted)
  })

  // DELETE /categories/:id
  // Body { replacementId? } — if provided, reassigns all expenses/savings before deleting.
  // Without replacement: fails with 409 if category is in use.
  fastify.delete('/categories/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const bodyResult = DeleteCategorySchema.safeParse(request.body)
    const replacementId = bodyResult.success ? bodyResult.data?.replacementId : undefined

    const category = await prisma.category.findUnique({
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
      const membership = await getActiveMembership(category.householdId!, userId)
      if (membership?.role !== 'ADMIN') {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    const totalInUse = category._count.expenses + category._count.savingsEntries

    if (totalInUse > 0) {
      if (!replacementId) {
        return reply.status(409).send({
          error: 'Category is in use',
          count: totalInUse,
          message: 'Provide a replacementId to reassign entries before deletion',
        })
      }

      // The replacement must be usable where this category was: same type, active,
      // and system-wide or from the same household (system categories: system-wide only)
      const replacement = await prisma.category.findFirst({
        where: {
          id: replacementId,
          NOT: { id },
          categoryType: category.categoryType,
          isActive: true,
          OR: category.isSystemWide
            ? [{ isSystemWide: true }]
            : [{ isSystemWide: true }, { householdId: category.householdId }],
        },
      })
      if (!replacement) return reply.status(400).send({ error: 'Replacement category not found' })

      // Retired budget years are read-only history: reassign only editable years, and
      // keep the category (deactivated) if retired entries still reference it.
      // Trashed entries are included so a later restore lands on a valid category
      const editable = { ...includingTrashed, budgetYear: { status: { not: 'RETIRED' as const } } }
      const retiredInUse =
        (await prisma.expense.count({ where: { ...includingTrashed, categoryId: id, budgetYear: { status: 'RETIRED' } } })) +
        (await prisma.savingsEntry.count({ where: { ...includingTrashed, categoryId: id, budgetYear: { status: 'RETIRED' } } }))

      await prisma.$transaction([
        prisma.expense.updateMany({ where: { categoryId: id, ...editable }, data: { categoryId: replacementId } }),
        prisma.savingsEntry.updateMany({ where: { categoryId: id, ...editable }, data: { categoryId: replacementId } }),
        retiredInUse > 0
          ? prisma.category.update({ where: { id }, data: { isActive: false } })
          : prisma.category.delete({ where: { id } }),
      ])
    } else {
      // Only trashed entries (not counted as "in use") may still reference it
      const trashedRefs =
        (await prisma.expense.count({ where: { categoryId: id, deletedAt: { not: null } } })) +
        (await prisma.savingsEntry.count({ where: { categoryId: id, deletedAt: { not: null } } }))
      if (trashedRefs > 0) await prisma.category.update({ where: { id }, data: { isActive: false } })
      else await prisma.category.delete({ where: { id } })
    }

    return reply.status(204).send()
  })
}
