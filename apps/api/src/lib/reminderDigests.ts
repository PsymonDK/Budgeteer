import { NotificationChannel } from '@prisma/client'
import { prisma } from './prisma'
import { loadReminderItems } from './reminderItems'
import {
  DEFAULT_DIGEST_TIME, DEFAULT_LEAD_DAYS, deliveryKey, digestTimeReached, planDigest, remindersFor, toISODate,
  type Reminder,
} from './reminders'

/** Who a digest goes to. */
export interface DigestRecipient {
  userId: string
  name: string
  email: string
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

/**
 * Channels digests go out on. Email (#258) and ntfy/webhook (#259) register here; which of
 * them reach a given member follows the admin / household / user settings (#260). Until
 * then there are none, and the digest job has nothing to do.
 */
export function activeChannels(): ReminderChannel[] {
  return []
}

/** A failed digest is retried on later runs the same day, up to this many attempts. */
export const MAX_DELIVERY_ATTEMPTS = 5
/** How far back delivered reminder stages are remembered, so none is sent twice. */
const SENT_LOOKBACK_DAYS = 62
/** Delivery log rows are kept this long. */
export const DELIVERY_RETENTION_DAYS = 90

/**
 * Sends each member's reminder digest on every active channel once their digest time has
 * come: at most one digest per member per channel per day, carrying only reminder stages not
 * sent before. Safe to run as often as the scheduler likes; a second run the same day sends
 * nothing new. Returns how many digests were sent.
 */
export async function runReminderDigests(now: Date = new Date(), channels: ReminderChannel[] = activeChannels()): Promise<number> {
  if (channels.length === 0) return 0
  // Per-member digest times and lead days come with the notification settings (#260)
  if (!digestTimeReached(now, DEFAULT_DIGEST_TIME)) return 0

  const today = toISODate(now)
  const items = await loadReminderItems(now)
  const userIds = [...new Set(items.flatMap((i) => i.recipientIds))]
  if (userIds.length === 0) return 0

  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, name: true, email: true } })
  const since = toISODate(new Date(now.getTime() - SENT_LOOKBACK_DAYS * 86_400_000))

  let sent = 0
  for (const user of users) {
    const reminders = remindersFor(user.id, items, today, DEFAULT_LEAD_DAYS, 'digest')
    if (reminders.length === 0) continue
    const recipientKey = `user:${user.id}`

    for (const channel of channels) {
      const history = await prisma.notificationDelivery.findMany({
        where: { recipientKey, channel: channel.channel, date: { gte: since } },
        select: { date: true, status: true, attempts: true, itemKeys: true },
      })
      const todays = history.find((d) => d.date === today)
      if (todays && (todays.status === 'SENT' || todays.attempts >= MAX_DELIVERY_ATTEMPTS)) continue

      const alreadySent = new Set(history.filter((d) => d.status === 'SENT').flatMap((d) => d.itemKeys))
      const digestReminders = planDigest(reminders, alreadySent)
      if (digestReminders.length === 0) continue

      const itemKeys = digestReminders.map(deliveryKey)
      const where = { recipientKey_channel_date: { recipientKey, channel: channel.channel, date: today } }
      try {
        await channel.send({ userId: user.id, name: user.name, email: user.email }, { date: today, reminders: digestReminders })
        await prisma.notificationDelivery.upsert({
          where,
          create: { recipientKey, userId: user.id, channel: channel.channel, date: today, itemKeys, status: 'SENT' },
          update: { itemKeys, status: 'SENT', attempts: { increment: 1 }, error: null },
        })
        sent++
      } catch (err) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
        await prisma.notificationDelivery.upsert({
          where,
          create: { recipientKey, userId: user.id, channel: channel.channel, date: today, itemKeys, status: 'FAILED', error },
          update: { itemKeys, status: 'FAILED', attempts: { increment: 1 }, error },
        })
      }
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
