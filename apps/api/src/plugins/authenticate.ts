import { FastifyRequest, FastifyReply } from 'fastify'

// Augment @fastify/jwt so request.user is typed throughout the API
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email: string
      role: 'SYSTEM_ADMIN' | 'USER'
    }
    user: {
      sub: string
      email: string
      role: 'SYSTEM_ADMIN' | 'USER'
    }
  }
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
  if (request.user.role !== 'SYSTEM_ADMIN') {
    return reply.status(403).send({ error: 'Forbidden' })
  }
}
