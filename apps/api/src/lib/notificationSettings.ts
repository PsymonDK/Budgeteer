// Notification settings at three levels: the install (system admins), each household (its
// admins) and each member. A level can only narrow the one above: a channel reaches a member
// for a household's items only when the install, the household and the member all allow it
// and there is somewhere to send it.
import type { WebhookFormat } from '@prisma/client'
import { prisma } from './prisma'
import { decryptSecret } from './secretBox'

export interface SystemNotificationSettings {
  inAppEnabled: boolean
  emailEnabled: boolean
  webhookEnabled: boolean
  webhookAllowPrivateNetwork: boolean
}

export interface HouseholdNotificationSettings {
  inAppEnabled: boolean
  emailEnabled: boolean
  webhookEnabled: boolean
  webhookUrl: string | null
  webhookFormat: WebhookFormat
  leadDays: number
}

export interface UserReminderSettings {
  reminderInApp: boolean
  reminderEmail: boolean
  reminderEmailAddress: string | null
  reminderWebhook: boolean
  reminderWebhookUrl: string | null
  reminderWebhookFormat: WebhookFormat
  reminderLeadDays: number | null
  reminderDigestTime: string
}

/** A webhook destination (its secret is loaded separately, only when sending). */
export interface WebhookDestination { url: string; format: WebhookFormat }

// Defaults when no row exists (matching the schema defaults)
export const SYSTEM_DEFAULTS: SystemNotificationSettings = {
  inAppEnabled: true, emailEnabled: false, webhookEnabled: false, webhookAllowPrivateNetwork: false,
}
export const HOUSEHOLD_DEFAULTS: HouseholdNotificationSettings = {
  inAppEnabled: true, emailEnabled: true, webhookEnabled: true, webhookUrl: null, webhookFormat: 'NTFY', leadDays: 2,
}
export const USER_DEFAULTS: UserReminderSettings = {
  reminderInApp: true, reminderEmail: true, reminderEmailAddress: null, reminderWebhook: true,
  reminderWebhookUrl: null, reminderWebhookFormat: 'NTFY', reminderLeadDays: null, reminderDigestTime: '08:00',
}

/** How a member is reminded about one household's items. */
export interface ResolvedReminderChannels {
  inApp: boolean
  /** Where reminder emails go, or null when email doesn't reach them */
  email: string | null
  /** The member's own ntfy topic or webhook, or null when the webhook channel doesn't reach them */
  webhook: WebhookDestination | null
  leadDays: number
  digestTime: string
}

/**
 * Narrows the install's channels by the household's and the member's settings. Email goes to
 * the member's reminder address, or their login email; a webhook needs the member's own URL.
 */
export function resolveChannels(
  system: SystemNotificationSettings,
  household: HouseholdNotificationSettings,
  user: UserReminderSettings,
  loginEmail: string,
): ResolvedReminderChannels {
  return {
    inApp: system.inAppEnabled && household.inAppEnabled && user.reminderInApp,
    email: system.emailEnabled && household.emailEnabled && user.reminderEmail ? (user.reminderEmailAddress || loginEmail) : null,
    webhook: system.webhookEnabled && household.webhookEnabled && user.reminderWebhook && user.reminderWebhookUrl
      ? { url: user.reminderWebhookUrl, format: user.reminderWebhookFormat }
      : null,
    leadDays: user.reminderLeadDays ?? household.leadDays,
    digestTime: user.reminderDigestTime,
  }
}

/** The household channel: its shared ntfy topic or webhook, when the install and the household allow webhooks. */
export function resolveHouseholdChannel(system: SystemNotificationSettings, household: HouseholdNotificationSettings): WebhookDestination | null {
  return system.webhookEnabled && household.webhookEnabled && household.webhookUrl
    ? { url: household.webhookUrl, format: household.webhookFormat }
    : null
}

/** What the level above allows, for greying out settings a member or household can't turn on. */
export function allowedChannels(system: SystemNotificationSettings, household?: HouseholdNotificationSettings) {
  return {
    inApp: system.inAppEnabled && (household?.inAppEnabled ?? true),
    email: system.emailEnabled && (household?.emailEnabled ?? true),
    webhook: system.webhookEnabled && (household?.webhookEnabled ?? true),
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

export async function loadSystemSettings(): Promise<SystemNotificationSettings> {
  const row = await prisma.notificationSettings.findUnique({ where: { id: 'default' } })
  return row
    ? { inAppEnabled: row.inAppEnabled, emailEnabled: row.emailEnabled, webhookEnabled: row.webhookEnabled, webhookAllowPrivateNetwork: row.webhookAllowPrivateNetwork }
    : SYSTEM_DEFAULTS
}

/** Settings per household id; households without a row get the defaults. */
export async function loadHouseholdSettings(householdIds: string[]): Promise<Map<string, HouseholdNotificationSettings>> {
  const rows = await prisma.householdNotificationSettings.findMany({ where: { householdId: { in: householdIds } } })
  const byId = new Map(rows.map((r) => [r.householdId, r]))
  return new Map(householdIds.map((id) => {
    const r = byId.get(id)
    return [id, r ? {
      inAppEnabled: r.inAppEnabled, emailEnabled: r.emailEnabled, webhookEnabled: r.webhookEnabled,
      webhookUrl: r.webhookUrl, webhookFormat: r.webhookFormat, leadDays: r.leadDays,
    } : HOUSEHOLD_DEFAULTS]
  }))
}

/** Reminder settings per user id; users without preferences get the defaults. */
export async function loadUserReminderSettings(userIds: string[]): Promise<Map<string, UserReminderSettings>> {
  const rows = await prisma.userPreferences.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true, reminderInApp: true, reminderEmail: true, reminderEmailAddress: true, reminderWebhook: true,
      reminderWebhookUrl: true, reminderWebhookFormat: true, reminderLeadDays: true, reminderDigestTime: true,
    },
  })
  const byId = new Map(rows.map(({ userId, ...r }) => [userId, r]))
  return new Map(userIds.map((id) => [id, byId.get(id) ?? USER_DEFAULTS]))
}

/** Decrypts a stored webhook secret; null when there's none or it can no longer be read. */
function readSecret(stored: string | null): string | null {
  if (!stored) return null
  try { return decryptSecret(stored) } catch { return null }
}

/** Webhook secrets (ntfy tokens, signing secrets) for members and households, only for sending. */
export async function loadWebhookSecrets(userIds: string[], householdIds: string[]) {
  const [users, households] = await Promise.all([
    prisma.userPreferences.findMany({ where: { userId: { in: userIds } }, select: { userId: true, reminderWebhookSecretEncrypted: true } }),
    prisma.householdNotificationSettings.findMany({ where: { householdId: { in: householdIds } }, select: { householdId: true, webhookSecretEncrypted: true } }),
  ])
  return {
    user: new Map(users.map((u) => [u.userId, readSecret(u.reminderWebhookSecretEncrypted)])),
    household: new Map(households.map((h) => [h.householdId, readSecret(h.webhookSecretEncrypted)])),
  }
}
