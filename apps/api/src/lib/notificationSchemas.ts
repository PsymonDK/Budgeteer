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
  // null = use each household's default
  reminderLeadDays: leadDaysSchema.nullable(),
  reminderDigestTime: digestTimeSchema,
}

/** PUT /admin/notification-settings */
export const UpdateSystemNotificationSchema = z
  .object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    webhookAllowPrivateNetwork: z.boolean(),
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
    leadDays: leadDaysSchema,
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' })
