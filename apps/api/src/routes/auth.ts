import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { verifyPassword } from '../lib/password'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const RefreshSchema = z.object({
  refreshToken: z.string(),
})

const REFRESH_TOKEN_EXPIRY_DAYS = 7
const MAX_FAILED_ATTEMPTS = 10
const LOCKOUT_MINUTES = 15

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const result = LoginSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body' })
    }
    const { email, password } = result.data

    const user = await prisma.user.findUnique({ where: { email } })

    // Deliberately vague: treat missing/inactive the same as wrong password
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    if (user.isProxy) {
      return reply.status(403).send({ error: 'This account cannot log in directly' })
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return reply.status(401).send({ error: 'Account temporarily locked. Try again later.' })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: attempts,
      }
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date()
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES)
        updateData.lockedUntil = lockUntil
      }
      await prisma.user.update({ where: { id: user.id }, data: updateData })
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    // Successful login — reset lockout state
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })

    const accessToken = fastify.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' }
    )

    const refreshTokenValue = crypto.randomBytes(40).toString('hex')
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)

    await prisma.refreshToken.create({
      data: { token: refreshTokenValue, userId: user.id, expiresAt },
    })

    return reply.send({
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    })
  })

  // POST /auth/refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const result = RefreshSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body' })
    }
    const { refreshToken } = result.data

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    if (!stored || stored.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } })
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Rotate: delete old token, issue new one
    await prisma.refreshToken.delete({ where: { id: stored.id } })

    const newRefreshToken = crypto.randomBytes(40).toString('hex')
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)

    await prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: user.id, expiresAt },
    })

    const accessToken = fastify.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' }
    )

    return reply.send({ accessToken, refreshToken: newRefreshToken })
  })

  // POST /auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    const result = RefreshSchema.safeParse(request.body)
    if (result.success) {
      // Silently ignore if token not found — logout should always succeed
      await prisma.refreshToken.deleteMany({ where: { token: result.data.refreshToken } })
    }
    return reply.send({ ok: true })
  })
}
