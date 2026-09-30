import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'
import { UpdateHouseholdNotificationSchema, UpdateSystemNotificationSchema } from '../lib/notificationSchemas'
import { allowedChannels, loadHouseholdSettings, loadSystemSettings, loadUserReminderSettings } from '../lib/notificationSettings'

const DeliveryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() })

// Notification settings at three levels: the install (system admins), each household (its
// admins) and each member (Profile). Each level can only narrow the one above; GET responses
// say what the level above allows so the UI can grey out what can't be turned on.
export async function notificationSettingsRoutes(fastify: FastifyInstance) {
  // GET /admin/notification-settings — which channels this install offers
  fastify.get('/admin/notification-settings', { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(await loadSystemSettings())
  })

  // PUT /admin/notification-settings
  fastify.put('/admin/notification-settings', { preHandler: requireAdmin }, async (request, reply) => {
    const result = UpdateSystemNotificationSchema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    await prisma.notificationSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...result.data }, update: result.data })
    return reply.send(await loadSystemSettings())
  })

  // GET /admin/notification-deliveries?limit=N — the latest reminder digests sent or attempted
  fastify.get('/admin/notification-deliveries', { preHandler: requireAdmin }, async (request, reply) => {
    const query = DeliveryQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: z.flattenError(query.error) })
    const deliveries = await prisma.notificationDelivery.findMany({
      orderBy: { updatedAt: 'desc' },
      take: query.data.limit ?? 50,
      select: {
        id: true, channel: true, date: true, status: true, attempts: true, error: true, itemKeys: true, updatedAt: true,
        user: { select: { name: true, email: true } },
        household: { select: { name: true } },
      },
    })
    return reply.send(deliveries.map(({ itemKeys, ...d }) => ({ ...d, reminderCount: itemKeys.length })))
  })

  // GET /households/:id/notification-settings — any member; editing needs a household admin
  fastify.get('/households/:id/notification-settings', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user
    const membership = await prisma.householdMember.findUnique({ where: { householdId_userId: { householdId: id, userId } } })
    if (!membership && role !== 'SYSTEM_ADMIN') return reply.status(403).send({ error: 'Forbidden' })

    const [system, households] = await Promise.all([loadSystemSettings(), loadHouseholdSettings([id])])
    return reply.send({ settings: households.get(id), allowed: allowedChannels(system) })
  })

  // PUT /households/:id/notification-settings — household admin only
  fastify.put('/households/:id/notification-settings', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user
    const membership = await prisma.householdMember.findUnique({ where: { householdId_userId: { householdId: id, userId } } })
    if (membership?.role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') return reply.status(403).send({ error: 'Forbidden' })

    const result = UpdateHouseholdNotificationSchema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    const household = await prisma.household.findUnique({ where: { id }, select: { id: true } })
    if (!household) return reply.status(404).send({ error: 'Household not found' })

    await prisma.householdNotificationSettings.upsert({ where: { householdId: id }, create: { householdId: id, ...result.data }, update: result.data })
    const [system, households] = await Promise.all([loadSystemSettings(), loadHouseholdSettings([id])])
    return reply.send({ settings: households.get(id), allowed: allowedChannels(system) })
  })

  // GET /me/notification-settings — the member's reminder settings and what the install allows.
  // Saved through PUT /users/me/preferences. Households can turn channels off for their items.
  fastify.get('/me/notification-settings', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const [user, system, userSettings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      loadSystemSettings(),
      loadUserReminderSettings([userId]),
    ])
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send({ settings: userSettings.get(userId), loginEmail: user.email, allowed: allowedChannels(system) })
  })
}
