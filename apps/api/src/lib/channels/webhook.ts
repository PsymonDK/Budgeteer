import crypto from 'crypto'
import type { WebhookFormat } from '@prisma/client'
import { digestSubject, dueText, formatAmount } from '../digestEmail'
import { deliveryKey } from '../reminders'
import { safePost, type PostResult } from '../safeHttp'
import type { Digest, DigestRecipient, ReminderChannel } from '../reminderDigests'

/** Where and how a digest is posted: an ntfy topic or a generic JSON webhook. */
export interface WebhookTarget {
  url: string
  format: WebhookFormat
  /** ntfy access token, or the JSON webhook's signing secret */
  secret: string | null
}

interface RenderOpts { appUrl: string; currency: string }

/** Splits an ntfy topic URL (https://ntfy.sh/our-bills) into the server and the topic. */
export function splitNtfyUrl(raw: string): { server: string; topic: string } {
  const url = new URL(raw)
  const parts = url.pathname.replace(/\/+$/, '').split('/')
  const topic = parts.pop() ?? ''
  if (!topic) throw new Error('An ntfy URL needs a topic, e.g. https://ntfy.sh/our-bills')
  url.pathname = parts.join('/') || '/'
  url.search = ''
  return { server: url.toString().replace(/\/+$/, ''), topic }
}

/** ntfy JSON publish body (JSON keeps non-ASCII text intact, unlike ntfy's header API). */
export function renderNtfyMessage(digest: Digest, { appUrl, currency }: RenderOpts, topic: string) {
  const households = new Set(digest.reminders.map((r) => r.item.householdId))
  const lines = digest.reminders.map((r) =>
    `• ${households.size > 1 ? `${r.item.householdName}: ` : ''}${r.item.label} — ${formatAmount(r.item.amount, currency)} — ${dueText(r)}`)
  const overdue = digest.reminders.some((r) => r.stage === 'OVERDUE')
  const base = appUrl.replace(/\/+$/, '')
  // ntfy shows up to 3 action buttons; each marks one payment paid straight from the notification
  const actions = digest.reminders
    .map((r) => ({ r, link: digest.actionLinks?.get(deliveryKey(r)) }))
    .filter((a) => a.link)
    .slice(0, 3)
    .map(({ r, link }) => ({ action: 'http', label: `Paid: ${r.item.label}`.slice(0, 40), url: link!.post, method: 'POST', clear: false }))
  return {
    topic,
    title: digestSubject(digest.reminders),
    message: lines.join('\n'),
    // 4 = high: overdue payments buzz; the rest arrive quietly as default priority
    priority: overdue ? 4 : 3,
    tags: [overdue ? 'warning' : 'calendar'],
    click: households.size === 1 ? `${base}/households/${[...households][0]}` : `${base}/`,
    ...(actions.length > 0 && { actions }),
  }
}

/** The generic JSON webhook payload (documented in docs/architecture.md). */
export function renderJsonPayload(recipient: Pick<DigestRecipient, 'userId' | 'householdId' | 'name'>, digest: Digest, { appUrl, currency }: RenderOpts) {
  const base = appUrl.replace(/\/+$/, '')
  return {
    type: 'budgeteer.reminder_digest',
    version: 1,
    date: digest.date,
    recipient: recipient.householdId && !recipient.userId
      ? { kind: 'household', id: recipient.householdId, name: recipient.name }
      : { kind: 'member', id: recipient.userId, name: recipient.name },
    summary: digestSubject(digest.reminders),
    reminders: digest.reminders.map((r) => ({
      key: r.item.key,
      kind: r.item.kind,
      label: r.item.label,
      amount: r.item.amount,
      currency,
      dueDate: r.item.dueDate,
      stage: r.stage,
      daysUntilDue: r.daysUntilDue,
      household: { id: r.item.householdId, name: r.item.householdName },
      url: `${base}/households/${r.item.householdId}`,
      // POST (no body) marks it paid, once; the page URL asks first
      markPaidUrl: digest.actionLinks?.get(deliveryKey(r))?.post ?? null,
      markPaidPage: digest.actionLinks?.get(deliveryKey(r))?.page ?? null,
    })),
  }
}

/** "sha256=<hex>" over "<timestamp>.<body>", so receivers can check the payload is ours and fresh. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

type Post = (url: string, body: string, headers: Record<string, string>, opts: { allowPrivate: boolean }) => Promise<PostResult>

/** Posts a digest (or any ntfy/JSON message) to one target. */
export async function postToWebhook(
  target: WebhookTarget,
  build: { ntfy: (topic: string) => object; json: () => object },
  opts: { allowPrivate: boolean; now?: Date },
  post: Post = safePost,
): Promise<void> {
  if (target.format === 'NTFY') {
    const { server, topic } = splitNtfyUrl(target.url)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (target.secret) headers.Authorization = `Bearer ${target.secret}`
    await post(server, JSON.stringify(build.ntfy(topic)), headers, { allowPrivate: opts.allowPrivate })
    return
  }
  const body = JSON.stringify(build.json())
  const timestamp = String(Math.floor((opts.now ?? new Date()).getTime() / 1000))
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Budgeteer-Timestamp': timestamp }
  if (target.secret) headers['X-Budgeteer-Signature'] = signPayload(target.secret, timestamp, body)
  await post(target.url, body, headers, { allowPrivate: opts.allowPrivate })
}

/** Sends reminder digests to members' own and households' shared ntfy topics or webhooks. */
export function createWebhookChannel(opts: RenderOpts & { allowPrivate: boolean }, post: Post = safePost): ReminderChannel {
  return {
    channel: 'WEBHOOK',
    async send(recipient, digest) {
      if (!recipient.webhook) throw new Error('No webhook target')
      await postToWebhook(recipient.webhook, {
        ntfy: (topic) => renderNtfyMessage(digest, opts, topic),
        json: () => renderJsonPayload(recipient, digest, opts),
      }, { allowPrivate: opts.allowPrivate }, post)
    },
  }
}

/** A short test message to a target, so members and admins can check it arrives. */
export async function sendTestWebhook(target: WebhookTarget, name: string, opts: RenderOpts & { allowPrivate: boolean }, post: Post = safePost): Promise<void> {
  const text = `Test from Budgeteer: payment reminders will arrive here${name ? ` for ${name}` : ''}.`
  await postToWebhook(target, {
    ntfy: (topic) => ({ topic, title: 'Budgeteer test', message: text, tags: ['white_check_mark'], click: `${opts.appUrl.replace(/\/+$/, '')}/` }),
    json: () => ({ type: 'budgeteer.test', version: 1, message: text }),
  }, { allowPrivate: opts.allowPrivate }, post)
}
