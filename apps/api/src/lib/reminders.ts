// Reminder rules for manual payments: when an unpaid manual bill, savings contribution or
// household transfer is due soon, due today or overdue, and who is reminded. Pure functions;
// lib/reminderItems.ts loads the items and lib/reminderDigests.ts sends the digests.

/** A digest reminds about an unpaid item once more, this many days after its due date */
export const OVERDUE_AFTER_DAYS = 3

export type ReminderKind = 'expense' | 'savings' | 'transfer'
export type ReminderStage = 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE'

/** Something the household pays by hand and hasn't paid yet. */
export interface ReminderItem {
  /** "expense:<occurrence id>", "savings:<occurrence id>" or "transfer:<transfer id>" */
  key: string
  kind: ReminderKind
  label: string
  /** Amount due, base currency */
  amount: string
  /** YYYY-MM-DD */
  dueDate: string
  householdId: string
  householdName: string
  budgetYearId: string
  /** Members to remind */
  recipientIds: string[]
}

export interface Reminder {
  item: ReminderItem
  stage: ReminderStage
  /** Days until the due date; negative when overdue */
  daysUntilDue: number
}

/** A Date's local calendar day as YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Due date in a month: the due day clamped to the month's length, or the 1st when there's none. */
export function dueDateFor(year: number, month: number, dueDay: number | null): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(dueDay ?? 1, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Whole days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day) }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

/**
 * Where an item stands today, for the in-app view: due within the lead time, due today,
 * or overdue (any day after its due date). Null when it isn't due yet.
 */
export function currentStage(dueDate: string, today: string, leadDays: number): ReminderStage | null {
  const until = daysBetween(today, dueDate)
  if (until < 0) return 'OVERDUE'
  if (until === 0) return 'DUE_TODAY'
  return until <= leadDays ? 'DUE_SOON' : null
}

/**
 * Which reminder a digest sends about an item today: due soon within the lead time, due
 * today, and overdue once `OVERDUE_AFTER_DAYS` have passed. Null in between. Each stage is
 * sent once (see planDigest), so the overdue reminder isn't repeated daily.
 */
export function digestStage(dueDate: string, today: string, leadDays: number): ReminderStage | null {
  const until = daysBetween(today, dueDate)
  if (until < 0) return -until >= OVERDUE_AFTER_DAYS ? 'OVERDUE' : null
  return currentStage(dueDate, today, leadDays)
}

/**
 * Who is reminded about an entry: its owner when it belongs to one member, members with a
 * share when split custom, everyone when shared (or when the owner has left).
 */
export function recipientsFor(
  entry: { ownership: 'SHARED' | 'INDIVIDUAL' | 'CUSTOM'; ownedByUserId: string | null; customSplits: { userId: string; pct: { toString(): string } }[] },
  memberIds: string[],
): string[] {
  const members = new Set(memberIds)
  if (entry.ownership === 'INDIVIDUAL' && entry.ownedByUserId && members.has(entry.ownedByUserId)) return [entry.ownedByUserId]
  if (entry.ownership === 'CUSTOM') {
    const sharers = entry.customSplits.filter((s) => parseFloat(s.pct.toString()) > 0 && members.has(s.userId)).map((s) => s.userId)
    if (sharers.length > 0) return sharers
  }
  return memberIds
}

const STAGE_ORDER: Record<ReminderStage, number> = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2 }

/**
 * A member's reminders today: the items they're reminded about that have a stage, overdue
 * first, then by due date. `mode` picks the in-app view (`current`) or the digest rule.
 * `leadDays` may depend on the item's household (a member's own setting, or each household's default).
 */
export function remindersFor(
  userId: string,
  items: ReminderItem[],
  today: string,
  leadDays: number | ((item: ReminderItem) => number),
  mode: 'current' | 'digest',
): Reminder[] {
  const leadFor = typeof leadDays === 'number' ? () => leadDays : leadDays
  const stageOf = mode === 'current' ? currentStage : digestStage
  const reminders: Reminder[] = []
  for (const item of items) {
    if (!item.recipientIds.includes(userId)) continue
    const stage = stageOf(item.dueDate, today, leadFor(item))
    if (stage) reminders.push({ item, stage, daysUntilDue: daysBetween(today, item.dueDate) })
  }
  return reminders.sort((a, b) =>
    STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.item.dueDate.localeCompare(b.item.dueDate) || a.item.label.localeCompare(b.item.label))
}

/** The key a delivered reminder is logged under: one per item per stage. */
export const deliveryKey = (r: Pick<Reminder, 'stage' | 'item'>) => `${r.stage}:${r.item.key}`

/** The reminders a digest should carry: those not already delivered on this channel. */
export function planDigest(reminders: Reminder[], alreadySent: Set<string>): Reminder[] {
  return reminders.filter((r) => !alreadySent.has(deliveryKey(r)))
}

/** Whether a digest time (HH:MM) has come by `now` (local time). */
export function digestTimeReached(now: Date, digestTime: string): boolean {
  const [h, m] = digestTime.split(':').map(Number)
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m
}
