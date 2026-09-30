import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { describeActionItem, hashToken, redeemActionToken, tokenState } from '../lib/reminderActions'

// Tokens are 32 random bytes, base64url: anything else can't be one
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/

// "Mark as paid" links from reminders. No login: the token is the permission, and it only
// marks its one item paid. GET only describes (so link scanners and prefetching change
// nothing); POST acts (the confirm page's button, ntfy action buttons, webhook receivers).
export async function reminderActionRoutes(fastify: FastifyInstance) {
  // GET /reminder-actions/:token — what the link is for, and whether it still works
  fastify.get('/reminder-actions/:token', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const { token } = request.params as { token: string }
    if (!TOKEN_FORMAT.test(token)) return reply.send({ state: 'INVALID', item: null })
    const row = await prisma.reminderActionToken.findUnique({ where: { tokenHash: hashToken(token) } })
    const state = tokenState(row, new Date())
    if (!row) return reply.send({ state, item: null })
    const item = await describeActionItem(row.itemKey)
    if (!item) return reply.send({ state: 'INVALID', item: null })
    return reply.send({ state: state === 'VALID' && item.done ? 'DONE' : state, item })
  })

  // POST /reminder-actions/:token — mark the item paid (once)
  fastify.post('/reminder-actions/:token', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const { token } = request.params as { token: string }
    if (!TOKEN_FORMAT.test(token)) return reply.status(404).send({ error: 'This link is not valid', code: 'LINK_INVALID' })
    const { state, result } = await redeemActionToken(token)
    if (state === 'INVALID') return reply.status(404).send({ error: 'This link is not valid', code: 'LINK_INVALID' })
    if (state === 'USED') return reply.status(410).send({ error: 'This link has already been used', code: 'LINK_USED' })
    if (state === 'EXPIRED') return reply.status(410).send({ error: 'This link has expired', code: 'LINK_EXPIRED' })
    if (!result?.ok) {
      const status = result?.code === 'NOT_FOUND' ? 404 : result?.code === 'BUDGET_YEAR_READ_ONLY' ? 400 : 409
      return reply.status(status).send({ error: result?.message ?? 'Could not mark it paid', code: result?.code })
    }
    return reply.send({ outcome: result.outcome })
  })
}
