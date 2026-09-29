import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../lib/password'
import { ACCESS_TOKEN_TTL, REFRESH_COOKIE, hashToken, issueSession, refreshCookieOptions, rotateRefreshToken } from '../lib/sessions'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// The refresh token normally arrives in the httpOnly cookie. A body token is still
// accepted so sessions from before the cookie switch (token kept in localStorage)
// are exchanged for a cookie once instead of being logged out.
const LegacyRefreshSchema = z.object({ refreshToken: z.string().min(1) }).partial().optional()

const MAX_FAILED_ATTEMPTS = 10
const LOCKOUT_MINUTES = 15

// Compared against when the account doesn't exist, so response time doesn't reveal
// which email addresses have accounts.
const dummyPasswordHash = hashPassword(crypto.randomBytes(32).toString('hex'))

export async function authRoutes(fastify: FastifyInstance) {
  const sign = (payload: { sub: string; email: string; role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER' }) =>
    fastify.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL })

  // POST /auth/login
  fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const result = LoginSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body' })
    }
    const { email, password } = result.data

    const user = await prisma.user.findUnique({ where: { email } })

    // Missing and inactive accounts look exactly like a wrong password
    if (!user || !user.isActive) {
      await verifyPassword(password, await dummyPasswordHash)
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

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

    // Proxy accounts (managed by a bookkeeper) can't sign in; answer like a bad password
    // so the response doesn't reveal that the account exists.
    if (user.isProxy) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    // Successful login — reset lockout state
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })

    const { accessToken, refreshToken } = await issueSession(user, sign)
    reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(request.protocol === 'https'))

    // The refresh token is only in the httpOnly cookie, never in the body
    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    })
  })

  // POST /auth/refresh — rotates the refresh token; reuse of a rotated token revokes all sessions
  fastify.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = LegacyRefreshSchema.safeParse(request.body)
    const presented = request.cookies[REFRESH_COOKIE] ?? (body.success ? body.data?.refreshToken : undefined)
    const cookieOptions = refreshCookieOptions(request.protocol === 'https')
    if (!presented) {
      return reply.status(401).send({ error: 'Not signed in', code: 'INVALID_REFRESH_TOKEN' })
    }

    const rotated = await rotateRefreshToken(presented, sign)
    if (!rotated.ok) {
      if (rotated.reason === 'reused') request.log.warn('Refresh token reuse detected; all sessions for the user were revoked')
      return reply
        .clearCookie(REFRESH_COOKIE, cookieOptions)
        .status(401)
        .send({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' })
    }

    reply.setCookie(REFRESH_COOKIE, rotated.refreshToken, cookieOptions)
    return reply.send({ accessToken: rotated.accessToken })
  })

  // POST /auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    const body = LegacyRefreshSchema.safeParse(request.body)
    const presented = request.cookies[REFRESH_COOKIE] ?? (body.success ? body.data?.refreshToken : undefined)
    if (presented) {
      // Silently ignore if token not found — logout should always succeed
      await prisma.refreshToken.deleteMany({
        where: { token: { in: [hashToken(presented), presented] } },
      })
    }
    return reply
      .clearCookie(REFRESH_COOKIE, refreshCookieOptions(request.protocol === 'https'))
      .send({ ok: true })
  })
}
