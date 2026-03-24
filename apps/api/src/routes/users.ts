import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'
import { requireAdmin } from '../plugins/authenticate'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
})

const UpdateUserSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' })

// Fields we expose on user objects — never return passwordHash
const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
} as const

export async function userRoutes(fastify: FastifyInstance) {
  // GET /users — list all users (admin only)
  fastify.get('/users', { preHandler: requireAdmin }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: 'asc' },
    })
    return reply.send(users)
  })

  // POST /users — create a new user (admin only)
  fastify.post('/users', { preHandler: requireAdmin }, async (request, reply) => {
    const result = CreateUserSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }
    const { email, name, password } = result.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ error: 'Email already in use' })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: { email, name, passwordHash, mustChangePassword: true },
      select: userSelect,
    })

    return reply.status(201).send(user)
  })

  // PUT /users/:id — edit name/email or deactivate (admin only)
  fastify.put('/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = UpdateUserSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return reply.status(404).send({ error: 'User not found' })
    }

    // Check email uniqueness if changing it
    if (result.data.email && result.data.email !== existing.email) {
      const taken = await prisma.user.findUnique({ where: { email: result.data.email } })
      if (taken) {
        return reply.status(409).send({ error: 'Email already in use' })
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: result.data,
      select: userSelect,
    })

    return reply.send(user)
  })
}
