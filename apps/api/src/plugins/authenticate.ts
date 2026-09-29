import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'
import { issuedBeforeRevocation } from '../lib/sessions'

// Augment @fastify/jwt so request.user is typed throughout the API
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email: string
      role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER'
    }
    user: {
      sub: string
      email: string
      role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER'
      iat?: number
    }
  }
}

// Routes a user with a temporary (admin-set) password may still call: enough to load
// their profile and choose a new password.
const PASSWORD_CHANGE_ALLOWED = new Set(['GET /users/me', 'POST /users/me/change-password'])

/**
 * Checks the token's user against the database on every request: the account must be
 * active, the token must post-date any session revocation, and a pending mandatory
 * password change blocks everything else. The role is taken from the database so a
 * demotion applies immediately instead of when the access token expires.
 */
async function verifyUserExists(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: request.user.sub },
    select: { id: true, isActive: true, role: true, mustChangePassword: true, sessionsValidAfter: true },
  })
  if (!user || !user.isActive || issuedBeforeRevocation(request.user.iat, user.sessionsValidAfter)) {
    reply.status(401).send({ error: 'Unauthorized' })
    return false
  }
  request.user.role = user.role

  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${request.method} ${request.routeOptions.url}`)) {
    reply.status(403).send({ error: 'You must change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' })
    return false
  }
  return true
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify()
  } catch (_err) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
  await verifyUserExists(request, reply)
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify()
  } catch (_err) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
  if (!(await verifyUserExists(request, reply))) return
  if (request.user.role !== 'SYSTEM_ADMIN') {
    return reply.status(403).send({ error: 'Forbidden' })
  }
}

