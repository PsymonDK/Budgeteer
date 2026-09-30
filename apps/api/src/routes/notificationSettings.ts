import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireAdmin } from '../plugins/authenticate'
import { UpdateHouseholdNotificationSchema, UpdateSystemNotificationSchema } from '../lib/notificationSchemas'
import { allowedChannels, loadHouseholdSettings, loadSystemSettings, loadUserReminderSettings } from '../lib/notificationSettings'
import { encryptSecret } from '../lib/secretBox'
import { loadSmtpConfig, sendTestEmail } from '../lib/channels/email'

const TestEmailSchema = z.object({ to: z.email() })

/** The install's settings for admins: channel switches and the SMTP server, never its password. */
async function adminSettingsView() {
  const [system, row] = await Promise.all([loadSystemSettings(), prisma.notificationSettings.findUnique({ where: { id: 'default' } })])
  return {
    ...system,
    smtp: {
      host: row?.smtpHost ?? null,
      port: row?.smtpPort ?? null,
      security: row?.smtpSecurity ?? 'STARTTLS',
      username: row?.smtpUsername ?? null,
      passwordSet: !!row?.smtpPasswordEncrypted,
      fromAddress: row?.smtpFromAddress ?? null,
      fromName: row?.smtpFromName ?? null,
    },
  }
}

const DeliveryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() })

// Notification settings at three levels: the install (system admins), each household (its
// admins) and each member (Profile). Each level can only narrow the one above; GET responses
// say what the level above allows so the UI can grey out what can't be turned on.
export async function notificationSettingsRoutes(fastify: FastifyInstance) {
  // GET /admin/notification-settings — which channels this install offers, and the email server
  fastify.get('/admin/notification-settings', { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(await adminSettingsView())
  })

  // PUT /admin/notification-settings
  fastify.put('/admin/notification-settings', { preHandler: requireAdmin }, async (request, reply) => {
    const result = UpdateSystemNotificationSchema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(result.error) })
    const { smtpPassword, ...fields } = result.data

    // Email can only be switched on once there's a server and a sender to send from
    const current = await prisma.notificationSettings.findUnique({ where: { id: 'default' } })
    const host = fields.smtpHost !== undefined ? fields.smtpHost : current?.smtpHost
    const from = fields.smtpFromAddress !== undefined ? fields.smtpFromAddress : current?.smtpFromAddress
    const emailOn = fields.emailEnabled ?? current?.emailEnabled ?? false
    if (emailOn && (!host || !from)) {
      return reply.status(400).send({ error: 'Set up the email server and sender address before turning email on', code: 'SMTP_NOT_CONFIGURED' })
    }

    let smtpPasswordEncrypted: string | null | undefined
    if (smtpPassword === null) smtpPasswordEncrypted = null
    else if (smtpPassword !== undefined) smtpPasswordEncrypted = encryptSecret(smtpPassword)
    const data = { ...fields, ...(smtpPasswordEncrypted !== undefined && { smtpPasswordEncrypted }) }

    await prisma.notificationSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data })
    return reply.send(await adminSettingsView())
  })

  // POST /admin/notification-settings/test-email — send a test with the saved email settings
  fastify.post('/admin/notification-settings/test-email', { preHandler: requireAdmin }, async (request, reply) => {
    const body = TestEmailSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Enter an email address to send the test to', details: z.flattenError(body.error) })
    let config
    try {
      config = await loadSmtpConfig()
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'SMTP_PASSWORD_UNREADABLE' })
    }
    if (!config) return reply.status(400).send({ error: 'Save the email server and sender address first', code: 'SMTP_NOT_CONFIGURED' })
    try {
      await sendTestEmail(config, body.data.to)
    } catch (err) {
      // The underlying message is the useful part (wrong password, TLS mismatch, host not found, refused)
      return reply.status(400).send({ error: `Couldn't send the test email: ${(err as Error).message}`, code: 'SMTP_ERROR' })
    }
    return reply.send({ sent: true })
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
