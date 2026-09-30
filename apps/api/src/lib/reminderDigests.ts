import { NotificationChannel } from '@prisma/client'
import { prisma } from './prisma'
import { loadReminderItems } from './reminderItems'
import { deliveryKey, digestTimeReached, planDigest, remindersFor, toISODate, type Reminder, type ReminderItem } from './reminders'
import {
  loadHouseholdSettings, loadSystemSettings, loadUserReminderSettings, resolveChannels,
  type ResolvedReminderChannels, type SystemNotificationSettings,
} from './notificationSettings'

/** Who a digest goes to, and where on this channel (an email address, or an ntfy/webhook URL). */
export interface DigestRecipient {
  userId: string
  name: string
  destination: string
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

/** Channels digests go out on. Email (#258) and ntfy/webhook (#259) register here. */
export function activeChannels(): ReminderChannel[] {
  return []
}

/** Whether the install allows a channel at all. */
function systemAllows(system: SystemNotificationSettings, channel: NotificationChannel): boolean {
  return channel === 'EMAIL' ? system.emailEnabled : system.webhookEnabled
}

/** A member's destination on a channel for one household's items, or null when it doesn't reach them. */
function destinationOn(resolved: ResolvedReminderChannels, channel: NotificationChannel): string | null {
  return channel === 'EMAIL' ? resolved.email : resolved.webhook
}

/** A failed digest is retried on later runs the same day, up to this many attempts. */
export const MAX_DELIVERY_ATTEMPTS = 5
/** How far back delivered reminder stages are remembered, so none is sent twice. */
const SENT_LOOKBACK_DAYS = 62
/** Delivery log rows are kept this long. */
export const DELIVERY_RETENTION_DAYS = 90

/**
 * Sends each member's reminder digest on every channel that reaches them, once their digest
 * time has come: at most one digest per member per channel per day, carrying only reminder
 * stages not sent before, and only items of households that allow the channel. Channels the
 * install has switched off send nothing. Safe to run as often as the scheduler likes; a
 * second run the same day sends nothing new. Returns how many digests were sent.
 */
export async function runReminderDigests(now: Date = new Date(), channels: ReminderChannel[] = activeChannels()): Promise<number> {
  if (channels.length === 0) return 0
  const system = await loadSystemSettings()
  const enabled = channels.filter((c) => systemAllows(system, c.channel))
  if (enabled.length === 0) return 0

  const today = toISODate(now)
  const items = await loadReminderItems(now)
  const userIds = [...new Set(items.flatMap((i) => i.recipientIds))]
  if (userIds.length === 0) return 0

  const [users, households, userSettings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, name: true, email: true } }),
    loadHouseholdSettings([...new Set(items.map((i) => i.householdId))]),
    loadUserReminderSettings(userIds),
  ])
  const since = toISODate(new Date(now.getTime() - SENT_LOOKBACK_DAYS * 86_400_000))

  let sent = 0
  for (const user of users) {
    const prefs = userSettings.get(user.id)!
    if (!digestTimeReached(now, prefs.reminderDigestTime)) continue
    const resolvedFor = (item: ReminderItem) => resolveChannels(system, households.get(item.householdId)!, prefs, user.email)
    const reminders = remindersFor(user.id, items, today, (item) => resolvedFor(item).leadDays, 'digest')
    if (reminders.length === 0) continue
    const recipientKey = `user:${user.id}`

    for (const channel of enabled) {
      // Only items of households whose settings let this channel reach the member
      const reachable = reminders.filter((r) => destinationOn(resolvedFor(r.item), channel.channel) !== null)
      if (reachable.length === 0) continue
      const destination = destinationOn(resolvedFor(reachable[0].item), channel.channel)!

      const history = await prisma.notificationDelivery.findMany({
        where: { recipientKey, channel: channel.channel, date: { gte: since } },
        select: { date: true, status: true, attempts: true, itemKeys: true },
      })
      const todays = history.find((d) => d.date === today)
      if (todays && (todays.status === 'SENT' || todays.attempts >= MAX_DELIVERY_ATTEMPTS)) continue

      const alreadySent = new Set(history.filter((d) => d.status === 'SENT').flatMap((d) => d.itemKeys))
      const digestReminders = planDigest(reachable, alreadySent)
      if (digestReminders.length === 0) continue

      const itemKeys = digestReminders.map(deliveryKey)
      const where = { recipientKey_channel_date: { recipientKey, channel: channel.channel, date: today } }
      try {
        await channel.send({ userId: user.id, name: user.name, destination }, { date: today, reminders: digestReminders })
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
