// "Mark as paid" links in reminders. Each reminder in a digest gets its own random token; only
// its SHA-256 is stored. A token works once, until it expires, and only marks its one item paid,
// following the same rules as the app. Opening the link shows a confirm page; only the POST acts.
import crypto from 'crypto'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma, notDeleted } from './prisma'
import { dueAmount } from './occurrences'
import { recalculateTransfer } from './budgetTransfer'
import { deliveryKey, type Reminder } from './reminders'

/** How long a Mark-as-paid link works */
export const ACTION_TOKEN_TTL_DAYS = 14

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

/** A new random token (256 bits, URL-safe) and the hash stored for it. */
export function newToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export type TokenState = 'VALID' | 'USED' | 'EXPIRED' | 'INVALID'

/** Whether a stored token can still be used. */
export function tokenState(row: { expiresAt: Date; usedAt: Date | null } | null, now: Date): TokenState {
  if (!row) return 'INVALID'
  if (row.usedAt) return 'USED'
  if (row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'VALID'
}

/**
 * Creates a token per reminder for one digest and returns the Mark-as-paid links by delivery
 * key: \`page\` opens the confirm page, \`post\` marks it paid directly (ntfy action buttons).
 */
export async function issueActionLinks(
  recipient: { userId: string | null },
  reminders: Reminder[],
  appUrl: string,
  now: Date = new Date(),
): Promise<Map<string, { page: string; post: string }>> {
  const base = appUrl.replace(/\/+$/, '')
  const expiresAt = new Date(now.getTime() + ACTION_TOKEN_TTL_DAYS * 86_400_000)
  const issued = reminders.map((r) => ({ reminder: r, ...newToken() }))
  if (issued.length === 0) return new Map()
  await prisma.reminderActionToken.createMany({
    data: issued.map(({ reminder, tokenHash }) => ({
      tokenHash, userId: recipient.userId, itemKey: reminder.item.key, householdId: reminder.item.householdId, expiresAt,
    })),
  })
  return new Map(issued.map(({ reminder, token }) => [deliveryKey(reminder), { page: `${base}/r/${token}`, post: `${base}/api/reminder-actions/${token}` }]))
}

// ── The item behind a token ───────────────────────────────────────────────────

export interface ActionItem {
  kind: 'expense' | 'savings' | 'transfer'
  label: string
  amount: string
  month: number
  year: number
  householdName: string
  /** Whether it's still waiting to be paid */
  done: boolean
}

type Kind = ActionItem['kind']
function parseKey(itemKey: string): { kind: Kind; id: string } | null {
  const [kind, id] = itemKey.split(':')
  return (kind === 'expense' || kind === 'savings' || kind === 'transfer') && id ? { kind, id } : null
}

/** What the link is for, to show on the confirm page. Null when the item no longer exists. */
export async function describeActionItem(itemKey: string): Promise<ActionItem | null> {
  const key = parseKey(itemKey)
  if (!key) return null
  if (key.kind === 'transfer') {
    const t = await prisma.budgetTransfer.findUnique({ where: { id: key.id }, include: { budgetYear: { select: { household: { select: { name: true } } } } } })
    if (!t) return null
    return {
      kind: 'transfer', label: 'Transfer to the budget account', amount: new Decimal(t.calculatedAmount.toString()).toFixed(2),
      month: t.month, year: t.year, householdName: t.budgetYear.household.name, done: t.status !== 'PENDING',
    }
  }
  const entry = { select: { label: true, budgetYear: { select: { household: { select: { name: true } } } } } }
  const o = key.kind === 'expense'
    ? await prisma.expenseOccurrence.findFirst({ where: { id: key.id, expense: notDeleted }, include: { expense: entry } })
    : await prisma.savingsOccurrence.findFirst({ where: { id: key.id, savingsEntry: notDeleted }, include: { savingsEntry: entry } })
  if (!o) return null
  const e = 'expense' in o ? o.expense : o.savingsEntry
  return { kind: key.kind, label: e.label, amount: dueAmount(o).toFixed(2), month: o.month, year: o.year, householdName: e.budgetYear.household.name, done: o.status !== 'PENDING' }
}

export type MarkResult =
  | { ok: true; outcome: 'MARKED' | 'ALREADY_DONE' }
  | { ok: false; code: 'NOT_FOUND' | 'BUDGET_YEAR_READ_ONLY' | 'AUTOMATIC' | 'CLOSED'; message: string }

/** Marks one item paid with the app's rules; already paid or dismissed counts as done. */
export async function markItemPaid(itemKey: string, now: Date = new Date()): Promise<MarkResult> {
  const key = parseKey(itemKey)
  const notFound: MarkResult = { ok: false, code: 'NOT_FOUND', message: 'This payment no longer exists' }
  if (!key) return notFound
  const readOnly: MarkResult = { ok: false, code: 'BUDGET_YEAR_READ_ONLY', message: 'That budget year is closed and read-only' }

  if (key.kind === 'transfer') {
    const t = await prisma.budgetTransfer.findUnique({
      where: { id: key.id }, include: { budgetYear: { select: { id: true, status: true, household: { select: { transferPaymentMethod: true } } } } },
    })
    if (!t) return notFound
    if (t.status !== 'PENDING') return { ok: true, outcome: 'ALREADY_DONE' }
    if (t.budgetYear.status === 'RETIRED') return readOnly
    if (t.budgetYear.household.transferPaymentMethod === 'AUTOMATIC') return { ok: false, code: 'AUTOMATIC', message: 'This transfer is made automatically' }
    await prisma.budgetTransfer.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'PAID', actualAmount: t.calculatedAmount, paidAt: now } })
    await recalculateTransfer(t.budgetYear.id).catch(() => {})
    return { ok: true, outcome: 'MARKED' }
  }

  const entry = { select: { paymentMethod: true, budgetYear: { select: { id: true, status: true } } } }
  const o = key.kind === 'expense'
    ? await prisma.expenseOccurrence.findFirst({ where: { id: key.id, expense: notDeleted }, include: { expense: entry } })
    : await prisma.savingsOccurrence.findFirst({ where: { id: key.id, savingsEntry: notDeleted }, include: { savingsEntry: entry } })
  if (!o) return notFound
  const e = 'expense' in o ? o.expense : o.savingsEntry
  if (o.status === 'PAID' || o.status === 'DISMISSED') return { ok: true, outcome: 'ALREADY_DONE' }
  if (e.budgetYear.status === 'RETIRED') return readOnly
  if (e.paymentMethod === 'AUTOMATIC') return { ok: false, code: 'AUTOMATIC', message: 'This payment is made automatically' }
  if (o.status === 'SKIPPED') return { ok: false, code: 'CLOSED', message: 'That month is closed; its amount was carried to the next month' }

  const data = { status: 'PAID' as const, paidAt: now, actualAmount: dueAmount(o), dismissReason: null }
  if (key.kind === 'expense') await prisma.expenseOccurrence.updateMany({ where: { id: o.id, status: 'PENDING' }, data })
  else await prisma.savingsOccurrence.updateMany({ where: { id: o.id, status: 'PENDING' }, data })
  await recalculateTransfer(e.budgetYear.id).catch(() => {})
  return { ok: true, outcome: 'MARKED' }
}

/**
 * Uses a token: marks its item paid and spends the token. The token is claimed first (only
 * one request can), so a link can't act twice.
 */
export async function redeemActionToken(token: string, now: Date = new Date()): Promise<{ state: TokenState; result?: MarkResult }> {
  const row = await prisma.reminderActionToken.findUnique({ where: { tokenHash: hashToken(token) } })
  const state = tokenState(row, now)
  if (state !== 'VALID' || !row) return { state }
  const { count } = await prisma.reminderActionToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } })
  if (count === 0) return { state: 'USED' }
  const result = await markItemPaid(row.itemKey, now)
  // A refused action (read-only year, automatic) leaves the link usable once the cause is fixed
  if (!result.ok) await prisma.reminderActionToken.update({ where: { id: row.id }, data: { usedAt: null } })
  return { state: 'VALID', result }
}

/** Deletes tokens a week after they expired. Returns how many. */
export async function purgeActionTokens(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000)
  const { count } = await prisma.reminderActionToken.deleteMany({ where: { expiresAt: { lt: cutoff } } })
  return count
}
