import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer'
import { SmtpSecurity } from '@prisma/client'
import { prisma } from '../prisma'
import { decryptSecret } from '../secretBox'
import { renderDigestEmail } from '../digestEmail'
import type { ReminderChannel } from '../reminderDigests'

export interface SmtpConfig {
  host: string
  port: number
  security: SmtpSecurity
  username: string | null
  password: string | null
  fromAddress: string
  fromName: string | null
}

/** What sending needs from a nodemailer transport (tests pass a fake). */
export interface MailSender {
  sendMail(message: SendMailOptions): Promise<unknown>
}

/** The usual port for each kind of connection, when none is set. */
export const DEFAULT_SMTP_PORT: Record<SmtpSecurity, number> = { NONE: 25, STARTTLS: 587, TLS: 465 }

/** The saved SMTP settings, or null when no server (or no sender address) is set up. */
export async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await prisma.notificationSettings.findUnique({ where: { id: 'default' } })
  if (!row?.smtpHost || !row.smtpFromAddress) return null
  return {
    host: row.smtpHost,
    port: row.smtpPort ?? DEFAULT_SMTP_PORT[row.smtpSecurity],
    security: row.smtpSecurity,
    username: row.smtpUsername,
    password: row.smtpPasswordEncrypted ? readPassword(row.smtpPasswordEncrypted) : null,
    fromAddress: row.smtpFromAddress,
    fromName: row.smtpFromName,
  }
}

function readPassword(stored: string): string {
  try {
    return decryptSecret(stored)
  } catch {
    throw new Error("The saved SMTP password can't be read: the encryption key has changed. Enter it again in Admin → Notifications.")
  }
}

export function createSmtpTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'TLS',
    requireTLS: config.security === 'STARTTLS',
    ignoreTLS: config.security === 'NONE',
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    // Fail fast rather than hold up the digest run
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

const fromHeader = (config: SmtpConfig) => (config.fromName ? { name: config.fromName, address: config.fromAddress } : config.fromAddress)

/** The public address of the app, for links in emails. */
export const appUrl = () => (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '')

/** Sends reminder digests by email through the configured SMTP server. */
export function createEmailChannel(
  config: SmtpConfig,
  opts: { appUrl: string; currency: string },
  transport: MailSender = createSmtpTransport(config),
): ReminderChannel {
  return {
    channel: 'EMAIL',
    async send(recipient, digest) {
      const actionUrls = new Map([...(digest.actionLinks ?? new Map())].map(([key, links]) => [key, links.page]))
      const { subject, text, html } = renderDigestEmail({ recipientName: recipient.name, digest, appUrl: opts.appUrl, currency: opts.currency, actionUrls })
      await transport.sendMail({ from: fromHeader(config), to: recipient.destination, subject, text, html })
    },
  }
}

/** Sends a short test email with the given settings; throws with the server's error when it fails. */
export async function sendTestEmail(config: SmtpConfig, to: string, transport: MailSender = createSmtpTransport(config)): Promise<void> {
  await transport.sendMail({
    from: fromHeader(config),
    to,
    subject: 'Budgeteer test email',
    text: `This is a test from Budgeteer at ${appUrl()}. Email is set up: payment reminders can now be sent by email.`,
  })
}
