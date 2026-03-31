import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../lib/password'
import { authenticate, requireAdmin } from '../plugins/authenticate'

const UpdateMeSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    currentPassword: z.string(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' })

const UpdatePreferencesSchema = z
  .object({
    defaultHouseholdId: z.string().nullable(),
    preferredCurrency: z.string().min(1).max(10),
    notifyOverAllocation: z.boolean(),
    notifyExpensesExceedIncome: z.boolean(),
    notifyNoSavings: z.boolean(),
    notifyUncategorised: z.boolean(),
    showDashboardSparklines: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' })

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).optional(),
  isProxy: z.boolean().optional(),
})

const UpdateUserSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    isActive: z.boolean(),
    isProxy: z.boolean(),
    role: z.enum(['SYSTEM_ADMIN', 'BOOKKEEPER', 'USER']),
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
  isProxy: true,
  avatarUrl: true,
  mustChangePassword: true,
  createdAt: true,
} as const

export async function userRoutes(fastify: FastifyInstance) {
  // GET /users — all authenticated users can list; needed so household admins can pick members
  fastify.get('/users', { preHandler: authenticate }, async (_request, reply) => {
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
    const { email, name, password, isProxy } = result.data

    if (!isProxy && !password) {
      return reply.status(400).send({ error: 'Password is required for non-proxy users' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ error: 'Email already in use' })
    }

    const passwordHash = isProxy
      ? await hashPassword(crypto.randomUUID())
      : await hashPassword(password!)
    const newUser = await prisma.user.create({
      data: { email, name, passwordHash, mustChangePassword: !isProxy, isProxy: isProxy ?? false },
      select: userSelect,
    })
    await prisma.userPreferences.create({ data: { userId: newUser.id } })

    return reply.status(201).send(newUser)
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

    // Guard: proxy users cannot be assigned elevated roles
    if (result.data.role && result.data.role !== 'USER') {
      const target = await prisma.user.findUnique({ where: { id } })
      if (target?.isProxy) return reply.status(400).send({ error: 'Proxy users cannot be assigned elevated roles' })
    }

    const user = await prisma.user.update({
      where: { id },
      data: result.data,
      select: userSelect,
    })

    return reply.send(user)
  })

  // POST /users/:id/reset-password — admin only, sets new password + mustChangePassword
  fastify.post('/users/:id/reset-password', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = z.object({ password: z.string().min(8) }).safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'User not found' })

    const passwordHash = await hashPassword(result.data.password)
    const user = await prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
      select: userSelect,
    })
    return reply.send(user)
  })

  // GET /users/me — returns current user + preferences
  fastify.get('/users/me', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...userSelect,
        preferences: {
          select: {
            preferredCurrency: true,
            defaultHouseholdId: true,
            notifyOverAllocation: true,
            notifyExpensesExceedIncome: true,
            notifyNoSavings: true,
            notifyUncategorised: true,
            showDashboardSparklines: true,
          },
        },
      },
    })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send(user)
  })

  // PUT /users/me — update name and/or email (email change requires currentPassword)
  fastify.put('/users/me', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const result = UpdateMeSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const { name, email, currentPassword } = result.data

    // Email change requires password verification
    if (email && email !== user.email) {
      if (!currentPassword) {
        return reply.status(400).send({ error: 'currentPassword is required to change email' })
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash)
      if (!valid) return reply.status(400).send({ error: 'Current password is incorrect' })

      const taken = await prisma.user.findUnique({ where: { email } })
      if (taken) return reply.status(409).send({ error: 'Email already in use' })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
      },
      select: userSelect,
    })
    return reply.send(updated)
  })

  // PUT /users/me/preferences — update preferences (partial)
  fastify.put('/users/me/preferences', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const result = UpdatePreferencesSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const prefs = await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...result.data },
      update: result.data,
    })
    return reply.send(prefs)
  })

  // POST /users/me/change-password — authenticated user changes their own password
  fastify.post('/users/me/change-password', { preHandler: authenticate }, async (request, reply) => {
    const result = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(8),
    }).safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const { sub: userId } = request.user
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const valid = await verifyPassword(result.data.currentPassword, user.passwordHash)
    if (!valid) return reply.status(400).send({ error: 'Current password is incorrect' })

    const passwordHash = await hashPassword(result.data.newPassword)
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
      select: userSelect,
    })
    return reply.send(updated)
  })

  // POST /users/me/avatar — upload avatar image
  fastify.post('/users/me/avatar', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Use JPG, PNG, or WebP.' })
    }

    const ext = data.mimetype === 'image/png' ? 'png' : data.mimetype === 'image/webp' ? 'webp' : 'jpg'
    const avatarDir = path.resolve(UPLOAD_DIR, 'avatars')
    fs.mkdirSync(avatarDir, { recursive: true })

    // Delete any existing avatar for this user
    for (const existing of ['jpg', 'png', 'webp']) {
      const fp = path.join(avatarDir, `${userId}.${existing}`)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }

    const filePath = path.join(avatarDir, `${userId}.${ext}`)
    const buffer = await data.toBuffer()
    fs.writeFileSync(filePath, buffer)

    const avatarUrl = `/uploads/avatars/${userId}.${ext}`
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: userSelect,
    })
    return reply.send({ avatarUrl: user.avatarUrl })
  })

  // DELETE /users/me/avatar — remove avatar
  fastify.delete('/users/me/avatar', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
    const avatarDir = path.resolve(UPLOAD_DIR, 'avatars')

    for (const ext of ['jpg', 'png', 'webp']) {
      const fp = path.join(avatarDir, `${userId}.${ext}`)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }

    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } })
    return reply.send({ avatarUrl: null })
  })
}
