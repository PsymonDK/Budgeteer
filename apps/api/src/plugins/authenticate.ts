import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'

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
    }
  }
}

async function verifyUserExists(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: request.user.sub },
    select: { id: true, isActive: true },
  })
  if (!user || !user.isActive) {
    reply.status(401).send({ error: 'Unauthorized' })
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

export async function requireBookkeeperOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
  if (!(await verifyUserExists(request, reply))) return
  if (!['SYSTEM_ADMIN', 'BOOKKEEPER'].includes(request.user.role)) {
    return reply.status(403).send({ error: 'Forbidden' })
  }
}
