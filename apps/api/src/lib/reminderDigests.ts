import { NotificationChannel } from '@prisma/client'
import { prisma } from './prisma'
import { BASE_CURRENCY } from './currency'
import { appUrl, createEmailChannel, loadSmtpConfig } from './channels/email'
import { createWebhookChannel, type WebhookTarget } from './channels/webhook'
import { loadReminderItems } from './reminderItems'
import {
  deliveryKey, digestTimeReached, planDigest, remindersFor, remindersForHousehold, toISODate, type Reminder, type ReminderItem,
} from './reminders'
import {
  HOUSEHOLD_DEFAULTS, loadHouseholdSettings, loadSystemSettings, loadUserReminderSettings, loadWebhookSecrets, resolveChannels,
  resolveHouseholdChannel, type ResolvedReminderChannels, type SystemNotificationSettings,
} from './notificationSettings'

/** Who a digest goes to, and where: an email address, or an ntfy topic / webhook. */
export interface DigestRecipient {
  /** The member, or null for a household's shared channel */
  userId: string | null
  householdId?: string
  name: string
  /** The email address, or the webhook URL */
  destination: string
  /** Set for the webhook channel */
  webhook?: WebhookTarget
}

/** A day's reminders for one recipient: due soon, due today and overdue, each sent once. */
export interface Digest {
  /** YYYY-MM-DD */
  date: string
  reminders: Reminder[]
}

/** A way of delivering digests (email, ntfy/webhook). Throwing marks the delivery failed. */
export interface ReminderChannel {
  channel: NotificationChannel
  send(recipient: DigestRecipient, digest: Digest): Promise<void>
}

/** Channels digests go out on: email once an SMTP server is set up, and ntfy/webhooks. */
export async function activeChannels(system: SystemNotificationSettings): Promise<ReminderChannel[]> {
  const opts = { appUrl: appUrl(), currency: BASE_CURRENCY }
  const channels: ReminderChannel[] = []
  if (system.emailEnabled) {
    const smtp = await loadSmtpConfig()
    if (smtp) channels.push(createEmailChannel(smtp, opts))
  }
  if (system.webhookEnabled) channels.push(createWebhookChannel({ ...opts, allowPrivate: system.webhookAllowPrivateNetwork }))
  return channels
}

/** Whether the install allows a channel at all. */
function systemAllows(system: SystemNotificationSettings, channel: NotificationChannel): boolean {
  return channel === 'EMAIL' ? system.emailEnabled : system.webhookEnabled
}

/** A member's destination on a channel for one household's items, or null when it doesn't reach them. */
function destinationOn(resolved: ResolvedReminderChannels, channel: NotificationChannel): string | null {
  return channel === 'EMAIL' ? resolved.email : resolved.webhook?.url ?? null
}

/** A failed digest is retried on later runs the same day, up to this many attempts. */
export const MAX_DELIVERY_ATTEMPTS = 5
/** How far back delivered reminder stages are remembered, so none is sent twice. */
const SENT_LOOKBACK_DAYS = 62
/** Delivery log rows are kept this long. */
export const DELIVERY_RETENTION_DAYS = 90
/** Local time a household channel's daily digest goes out */
export const HOUSEHOLD_DIGEST_TIME = '08:00'

/**
 * Sends each recipient's digest once, unless today's is already sent (or has failed too often),
 * with only the reminder stages not delivered before on this channel. Logs the outcome.
 */
async function deliver(
  channel: ReminderChannel,
  recipient: DigestRecipient,
  recipientKey: string,
  reminders: Reminder[],
  today: string,
  since: string,
): Promise<boolean> {
  const history = await prisma.notificationDelivery.findMany({
    where: { recipientKey, channel: channel.channel, date: { gte: since } },
    select: { date: true, status: true, attempts: true, itemKeys: true },
  })
  const todays = history.find((d) => d.date === today)
  if (todays && (todays.status === 'SENT' || todays.attempts >= MAX_DELIVERY_ATTEMPTS)) return false

  const alreadySent = new Set(history.filter((d) => d.status === 'SENT').flatMap((d) => d.itemKeys))
  const digestReminders = planDigest(reminders, alreadySent)
  if (digestReminders.length === 0) return false

  const itemKeys = digestReminders.map(deliveryKey)
  const owner = { userId: recipient.userId, householdId: recipient.userId ? null : recipient.householdId ?? null }
  const where = { recipientKey_channel_date: { recipientKey, channel: channel.channel, date: today } }
  try {
    await channel.send(recipient, { date: today, reminders: digestReminders })
    await prisma.notificationDelivery.upsert({
      where,
      create: { recipientKey, ...owner, channel: channel.channel, date: today, itemKeys, status: 'SENT' },
      update: { itemKeys, status: 'SENT', attempts: { increment: 1 }, error: null },
    })
    return true
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    await prisma.notificationDelivery.upsert({
      where,
      create: { recipientKey, ...owner, channel: channel.channel, date: today, itemKeys, status: 'FAILED', error },
      update: { itemKeys, status: 'FAILED', attempts: { increment: 1 }, error },
    })
    return false
  }
}

/**
 * Sends reminder digests on every channel the install allows, once each recipient's digest time
 * has come: each member on the channels that reach them (only items of households that allow
 * the channel), and each household's shared ntfy topic or webhook. At most one digest per
 * recipient per channel per day, carrying only reminder stages not sent before. Safe to run as
 * often as the scheduler likes. Returns how many digests were sent.
 */
export async function runReminderDigests(now: Date = new Date(), only?: ReminderChannel[]): Promise<number> {
  const system = await loadSystemSettings()
  if (!system.emailEnabled && !system.webhookEnabled) return 0
  const channels = (only ?? await activeChannels(system)).filter((c) => systemAllows(system, c.channel))
  if (channels.length === 0) return 0

  const today = toISODate(now)
  const items = await loadReminderItems(now)
  if (items.length === 0) return 0
  const userIds = [...new Set(items.flatMap((i) => i.recipientIds))]
  const householdIds = [...new Set(items.map((i) => i.householdId))]

  const [users, households, userSettings, secrets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, name: true, email: true } }),
    loadHouseholdSettings(householdIds),
    loadUserReminderSettings(userIds),
    loadWebhookSecrets(userIds, householdIds),
  ])
  const since = toISODate(new Date(now.getTime() - SENT_LOOKBACK_DAYS * 86_400_000))
  let sent = 0

  // Members
  for (const user of users) {
    const prefs = userSettings.get(user.id)!
    if (!digestTimeReached(now, prefs.reminderDigestTime)) continue
    const resolvedFor = (item: ReminderItem) => resolveChannels(system, households.get(item.householdId) ?? HOUSEHOLD_DEFAULTS, prefs, user.email)
    const reminders = remindersFor(user.id, items, today, (item) => resolvedFor(item).leadDays, 'digest')
    if (reminders.length === 0) continue

    for (const channel of channels) {
      // Only items of households whose settings let this channel reach the member
      const reachable = reminders.filter((r) => destinationOn(resolvedFor(r.item), channel.channel) !== null)
      if (reachable.length === 0) continue
      const resolved = resolvedFor(reachable[0].item)
      const recipient: DigestRecipient = {
        userId: user.id,
        name: user.name,
        destination: destinationOn(resolved, channel.channel)!,
        ...(channel.channel === 'WEBHOOK' && resolved.webhook && { webhook: { ...resolved.webhook, secret: secrets.user.get(user.id) ?? null } }),
      }
      if (await deliver(channel, recipient, `user:${user.id}`, reachable, today, since)) sent++
    }
  }

  // Households' shared ntfy topics / webhooks
  const webhook = channels.find((c) => c.channel === 'WEBHOOK')
  if (webhook && digestTimeReached(now, HOUSEHOLD_DIGEST_TIME)) {
    for (const householdId of householdIds) {
      const settings = households.get(householdId) ?? HOUSEHOLD_DEFAULTS
      const target = resolveHouseholdChannel(system, settings)
      if (!target) continue
      const reminders = remindersForHousehold(householdId, items, today, settings.leadDays, 'digest')
      if (reminders.length === 0) continue
      const recipient: DigestRecipient = {
        userId: null,
        householdId,
        name: reminders[0].item.householdName,
        destination: target.url,
        webhook: { ...target, secret: secrets.household.get(householdId) ?? null },
      }
      if (await deliver(webhook, recipient, `household:${householdId}`, reminders, today, since)) sent++
    }
  }
  return sent
}

/** Deletes delivery log rows older than the retention period. Returns how many. */
export async function purgeNotificationDeliveries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000)
  const { count } = await prisma.notificationDelivery.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return count
}
