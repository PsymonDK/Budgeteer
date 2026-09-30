import { describe, expect, it } from 'vitest'
import {
  HOUSEHOLD_DEFAULTS, SYSTEM_DEFAULTS, USER_DEFAULTS, allowedChannels, resolveChannels, resolveHouseholdChannel,
} from './notificationSettings'
import { UpdateHouseholdNotificationSchema, UpdateSystemNotificationSchema, reminderPreferenceFields } from './notificationSchemas'
import { z } from 'zod'

const allOn = { ...SYSTEM_DEFAULTS, emailEnabled: true, webhookEnabled: true }
const user = (over: Partial<typeof USER_DEFAULTS> = {}) => ({ ...USER_DEFAULTS, reminderWebhookUrl: 'https://ntfy.sh/anna', ...over })

describe('resolveChannels: each level narrows the one above', () => {
  it('reaches a member on every channel when everyone allows it', () => {
    expect(resolveChannels(allOn, HOUSEHOLD_DEFAULTS, user(), 'anna@home.dk')).toEqual({
      inApp: true, email: 'anna@home.dk', webhook: { url: 'https://ntfy.sh/anna', format: 'NTFY' }, leadDays: 2, digestTime: '08:00',
    })
  })

  it('stops a channel the install turns off, whatever the household and member say', () => {
    const r = resolveChannels({ ...allOn, emailEnabled: false, inAppEnabled: false }, HOUSEHOLD_DEFAULTS, user(), 'anna@home.dk')
    expect(r.email).toBeNull()
    expect(r.inApp).toBe(false)
    expect(r.webhook).toEqual({ url: 'https://ntfy.sh/anna', format: 'NTFY' })
  })

  it('lets a household turn a channel off for its items', () => {
    expect(resolveChannels(allOn, { ...HOUSEHOLD_DEFAULTS, webhookEnabled: false }, user(), 'a@b.dk').webhook).toBeNull()
  })

  it('lets a member opt out without a household or admin setting changing', () => {
    expect(resolveChannels(allOn, HOUSEHOLD_DEFAULTS, user({ reminderEmail: false }), 'a@b.dk').email).toBeNull()
  })

  it('emails the reminder address when set, else the login email', () => {
    expect(resolveChannels(allOn, HOUSEHOLD_DEFAULTS, user({ reminderEmailAddress: 'bills@home.dk' }), 'a@b.dk').email).toBe('bills@home.dk')
  })

  it('needs the member’s own URL for the webhook channel', () => {
    expect(resolveChannels(allOn, HOUSEHOLD_DEFAULTS, user({ reminderWebhookUrl: null }), 'a@b.dk').webhook).toBeNull()
  })

  it('uses the member’s lead days, else the household’s', () => {
    expect(resolveChannels(allOn, { ...HOUSEHOLD_DEFAULTS, leadDays: 5 }, user(), 'a@b.dk').leadDays).toBe(5)
    expect(resolveChannels(allOn, { ...HOUSEHOLD_DEFAULTS, leadDays: 5 }, user({ reminderLeadDays: 0 }), 'a@b.dk').leadDays).toBe(0)
  })
})

describe('household channel and what is allowed', () => {
  it('sends to the household URL only when the install and the household allow webhooks', () => {
    const household = { ...HOUSEHOLD_DEFAULTS, webhookUrl: 'https://ntfy.sh/home', webhookFormat: 'JSON' as const }
    expect(resolveHouseholdChannel(allOn, household)).toEqual({ url: 'https://ntfy.sh/home', format: 'JSON' })
    expect(resolveHouseholdChannel(SYSTEM_DEFAULTS, household)).toBeNull() // webhooks off by default
    expect(resolveHouseholdChannel(allOn, { ...household, webhookEnabled: false })).toBeNull()
  })

  it('reports what the levels above allow', () => {
    expect(allowedChannels(SYSTEM_DEFAULTS)).toEqual({ inApp: true, email: false, webhook: false })
    expect(allowedChannels(allOn, { ...HOUSEHOLD_DEFAULTS, emailEnabled: false })).toEqual({ inApp: true, email: false, webhook: true })
  })
})

describe('settings schemas', () => {
  const Prefs = z.object(reminderPreferenceFields).partial()

  it('accepts http(s) URLs and clears on an empty string', () => {
    expect(UpdateHouseholdNotificationSchema.parse({ webhookUrl: 'https://ntfy.sh/home' }).webhookUrl).toBe('https://ntfy.sh/home')
    expect(UpdateHouseholdNotificationSchema.parse({ webhookUrl: '  ' }).webhookUrl).toBeNull()
    expect(UpdateHouseholdNotificationSchema.safeParse({ webhookUrl: 'ftp://files.example.com' }).success).toBe(false)
    expect(UpdateHouseholdNotificationSchema.safeParse({ webhookUrl: 'not a url' }).success).toBe(false)
  })

  it('keeps lead days to 0–14 and the digest time to HH:MM', () => {
    expect(UpdateHouseholdNotificationSchema.safeParse({ leadDays: 15 }).success).toBe(false)
    expect(Prefs.safeParse({ reminderLeadDays: null }).success).toBe(true)
    expect(Prefs.safeParse({ reminderDigestTime: '07:30' }).success).toBe(true)
    expect(Prefs.safeParse({ reminderDigestTime: '7:30' }).success).toBe(false)
    expect(Prefs.safeParse({ reminderDigestTime: '24:00' }).success).toBe(false)
  })

  it('checks the reminder email and clears it on an empty string', () => {
    expect(Prefs.parse({ reminderEmailAddress: '' }).reminderEmailAddress).toBeNull()
    expect(Prefs.safeParse({ reminderEmailAddress: 'not-an-email' }).success).toBe(false)
  })

  it('needs at least one setting to change', () => {
    expect(UpdateSystemNotificationSchema.safeParse({}).success).toBe(false)
    expect(UpdateSystemNotificationSchema.safeParse({ emailEnabled: true }).success).toBe(true)
  })
})
