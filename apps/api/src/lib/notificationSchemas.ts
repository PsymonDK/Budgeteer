import { z } from 'zod'

/** An http(s) URL (ntfy topic or webhook), or null/"" to clear it. Where it may point is checked when sending (#259). */
export const optionalHttpUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v),
  z.url({ protocol: /^https?$/, message: 'Enter an http:// or https:// URL' }).max(500).nullable(),
)

/** Days before the due date a "due soon" reminder starts: 0 (only on the day) to 14. */
export const leadDaysSchema = z.number().int().min(0).max(14)

/** A local time of day, HH:MM (24-hour). */
export const digestTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 08:00')

/** The member's own reminder settings, part of PUT /users/me/preferences. */
export const reminderPreferenceFields = {
  reminderInApp: z.boolean(),
  reminderEmail: z.boolean(),
  reminderEmailAddress: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.email().max(200).nullable()),
  reminderWebhook: z.boolean(),
  reminderWebhookUrl: optionalHttpUrl,
  reminderWebhookFormat: z.enum(['NTFY', 'JSON']),
  // ntfy access token or signing secret: a new one, null to clear, left out to keep
  reminderWebhookSecret: z.string().min(1).max(500).nullable(),
  // null = use each household's default
  reminderLeadDays: leadDaysSchema.nullable(),
  reminderDigestTime: digestTimeSchema,
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v)

/** PUT /admin/notification-settings. `smtpPassword`: a new password, null to clear, left out to keep. */
export const UpdateSystemNotificationSchema = z
  .object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    webhookAllowPrivateNetwork: z.boolean(),
    smtpHost: z.preprocess(emptyToNull, z.string().max(255).regex(/^[A-Za-z0-9.-]+$/, 'Enter a host name, e.g. smtp.example.com').nullable()),
    smtpPort: z.number().int().min(1).max(65535).nullable(),
    smtpSecurity: z.enum(['NONE', 'STARTTLS', 'TLS']),
    smtpUsername: z.preprocess(emptyToNull, z.string().max(255).nullable()),
    smtpPassword: z.string().min(1).max(500).nullable(),
    smtpFromAddress: z.preprocess(emptyToNull, z.email().max(255).nullable()),
    smtpFromName: z.preprocess(emptyToNull, z.string().max(100).nullable()),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })

/** PUT /households/:id/notification-settings */
export const UpdateHouseholdNotificationSchema = z
  .object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    webhookUrl: optionalHttpUrl,
    webhookFormat: z.enum(['NTFY', 'JSON']),
    // ntfy access token or signing secret: a new one, null to clear, left out to keep
    webhookSecret: z.string().min(1).max(500).nullable(),
    leadDays: leadDaysSchema,
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })
