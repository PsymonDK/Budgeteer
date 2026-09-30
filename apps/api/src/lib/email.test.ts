import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { decryptSecret, encryptSecret, settingsKey } from './secretBox'
import { digestSubject, dueText, formatDay, renderDigestEmail } from './digestEmail'
import { createEmailChannel, type SmtpConfig } from './channels/email'
import { UpdateSystemNotificationSchema } from './notificationSchemas'
import type { Reminder, ReminderItem } from './reminders'

const reminder = (over: Partial<ReminderItem> & { key: string }, stage: Reminder['stage'], dueDate: string): Reminder => ({
  stage,
  daysUntilDue: 0,
  item: {
    kind: 'expense', label: over.key, amount: '1234.5', dueDate, householdId: 'h1', householdName: 'Home', budgetYearId: 'by1',
    recipientIds: ['anna'], ...over,
  },
})

describe('secretBox', () => {
  const key = crypto.randomBytes(32)

  it('round-trips a secret and never stores it in plain text', () => {
    const stored = encryptSecret('hunter2', key)
    expect(stored).not.toContain('hunter2')
    expect(stored.startsWith('v1:')).toBe(true)
    expect(decryptSecret(stored, key)).toBe('hunter2')
  })

  it('encrypts the same secret differently each time', () => {
    expect(encryptSecret('hunter2', key)).not.toBe(encryptSecret('hunter2', key))
  })

  it('refuses a tampered value or the wrong key', () => {
    const [v, iv, tag, ct] = encryptSecret('hunter2', key).split(':')
    const flipped = Buffer.from(ct, 'base64url'); flipped[0] ^= 1
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join(':'), key)).toThrow()
    expect(() => decryptSecret(encryptSecret('hunter2', key), crypto.randomBytes(32))).toThrow()
  })

  it('uses SETTINGS_ENCRYPTION_KEY, else a key derived from JWT_SECRET', () => {
    const a = settingsKey({ SETTINGS_ENCRYPTION_KEY: 'k1', JWT_SECRET: 'j' } as NodeJS.ProcessEnv)
    const b = settingsKey({ JWT_SECRET: 'j' } as NodeJS.ProcessEnv)
    expect(a).toHaveLength(32)
    expect(b).toHaveLength(32)
    expect(a.equals(b)).toBe(false)
    expect(() => settingsKey({} as NodeJS.ProcessEnv)).toThrow(/SETTINGS_ENCRYPTION_KEY/)
  })
})

describe('digest email', () => {
  const reminders = [
    reminder({ key: 'expense:power', label: 'Electricity' }, 'OVERDUE', '2026-08-20'),
    reminder({ key: 'savings:holiday', label: 'Holiday fund', kind: 'savings' }, 'DUE_TODAY', '2026-09-30'),
    reminder({ key: 'expense:tv', label: 'Netflix <HD>' }, 'DUE_SOON', '2026-10-01'),
  ]
  const email = renderDigestEmail({
    recipientName: 'Anna Berg', digest: { date: '2026-09-30', reminders }, appUrl: 'https://budget.example.com/', currency: 'DKK',
  })

  it('says how many payments and what is urgent in the subject', () => {
    expect(email.subject).toBe('3 payments to make by hand: 1 overdue, 1 due today')
    expect(digestSubject([reminders[2]])).toBe('1 payment to make by hand')
  })

  it('describes when each is due', () => {
    expect(formatDay('2026-10-01')).toBe('Thu 1 Oct')
    expect(dueText(reminders[0])).toBe('Overdue since Thu 20 Aug')
    expect(dueText(reminders[1])).toBe('Due today')
  })

  it('has a plain-text version with amounts and links', () => {
    expect(email.text).toContain('Hi Anna,')
    expect(email.text).toContain('- Electricity: 1,234.50 DKK — Overdue since Thu 20 Aug')
    expect(email.text).toContain('https://budget.example.com/households/h1')
    expect(email.text).toContain('https://budget.example.com/profile')
  })

  it('escapes names in the HTML version', () => {
    expect(email.html).toContain('Netflix &lt;HD&gt;')
    expect(email.html).not.toContain('Netflix <HD>')
  })

  it('groups by household when there is more than one', () => {
    const two = renderDigestEmail({
      recipientName: 'Anna', appUrl: 'https://b.example', currency: 'DKK',
      digest: { date: '2026-09-30', reminders: [...reminders, reminder({ key: 'expense:gym', householdId: 'h2', householdName: 'Cabin' }, 'DUE_SOON', '2026-10-01')] },
    })
    expect(two.text).toContain('Home\n')
    expect(two.text).toContain('Cabin\n')
  })
})

describe('email channel', () => {
  const config: SmtpConfig = {
    host: 'smtp.example.com', port: 587, security: 'STARTTLS', username: 'u', password: 'p', fromAddress: 'budget@example.com', fromName: 'Budgeteer',
  }

  it('sends the digest to the member’s address from the configured sender', async () => {
    const sent: Record<string, unknown>[] = []
    const channel = createEmailChannel(config, { appUrl: 'https://b.example', currency: 'DKK' }, { sendMail: async (m) => { sent.push(m as Record<string, unknown>); return {} } })
    await channel.send({ userId: 'anna', name: 'Anna', destination: 'anna@home.dk' }, { date: '2026-09-30', reminders: [reminder({ key: 'expense:tv' }, 'DUE_TODAY', '2026-09-30')] })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'anna@home.dk', from: { name: 'Budgeteer', address: 'budget@example.com' }, subject: '1 payment to make by hand: 1 due today' })
    expect(sent[0].text).toBeTruthy()
    expect(sent[0].html).toBeTruthy()
  })

  it('lets a server error through so the delivery is logged as failed', async () => {
    const channel = createEmailChannel(config, { appUrl: 'https://b.example', currency: 'DKK' }, { sendMail: async () => { throw new Error('535 Authentication failed') } })
    await expect(channel.send({ userId: 'a', name: 'A', destination: 'a@b.dk' }, { date: '2026-09-30', reminders: [] })).rejects.toThrow('535')
  })
})

describe('SMTP settings schema', () => {
  it('accepts a server, sender and password, and clears empty fields', () => {
    const parsed = UpdateSystemNotificationSchema.parse({ smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecurity: 'STARTTLS', smtpFromAddress: 'b@example.com', smtpUsername: '', smtpPassword: 'secret' })
    expect(parsed).toMatchObject({ smtpHost: 'smtp.example.com', smtpUsername: null, smtpPassword: 'secret' })
  })

  it('rejects a bad host, port or sender', () => {
    expect(UpdateSystemNotificationSchema.safeParse({ smtpHost: 'smtp example' }).success).toBe(false)
    expect(UpdateSystemNotificationSchema.safeParse({ smtpPort: 70000 }).success).toBe(false)
    expect(UpdateSystemNotificationSchema.safeParse({ smtpFromAddress: 'nope' }).success).toBe(false)
    expect(UpdateSystemNotificationSchema.safeParse({ smtpSecurity: 'SSL' }).success).toBe(false)
  })
})
