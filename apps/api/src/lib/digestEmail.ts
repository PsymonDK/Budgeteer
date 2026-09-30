// The reminder digest as an email: plain text plus a simple HTML version with inline styles
// (email clients ignore stylesheets). Every value from the database is escaped.
import type { Digest } from './reminderDigests'
import type { Reminder, ReminderStage } from './reminders'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Wed 1 Oct" from YYYY-MM-DD. */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`
}

export function formatAmount(amount: string, currency: string): string {
  return `${Number(amount).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

/** When it's due, in words: "Overdue since Thu 20 Aug", "Due today", "Due Wed 1 Oct". */
export function dueText(r: Pick<Reminder, 'stage' | 'item'>): string {
  const labels: Record<ReminderStage, string> = {
    OVERDUE: `Overdue since ${formatDay(r.item.dueDate)}`,
    DUE_TODAY: 'Due today',
    DUE_SOON: `Due ${formatDay(r.item.dueDate)}`,
  }
  return labels[r.stage]
}

export function digestSubject(reminders: Reminder[]): string {
  const overdue = reminders.filter((r) => r.stage === 'OVERDUE').length
  const today = reminders.filter((r) => r.stage === 'DUE_TODAY').length
  const n = reminders.length
  const head = `${n} ${n === 1 ? 'payment' : 'payments'} to make by hand`
  const detail = [overdue && `${overdue} overdue`, today && `${today} due today`].filter(Boolean).join(', ')
  return detail ? `${head}: ${detail}` : head
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Groups reminders by household, keeping their order. */
function byHousehold(reminders: Reminder[]) {
  const groups = new Map<string, { name: string; reminders: Reminder[] }>()
  for (const r of reminders) {
    const g = groups.get(r.item.householdId) ?? { name: r.item.householdName, reminders: [] }
    g.reminders.push(r)
    groups.set(r.item.householdId, g)
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g }))
}

export interface DigestEmailInput {
  recipientName: string
  digest: Digest
  /** The app's public address, for links, e.g. https://budget.example.com */
  appUrl: string
  currency: string
  /** Optional per-reminder action link (Mark as paid), keyed by deliveryKey */
  actionUrls?: Map<string, string>
}

export function renderDigestEmail({ recipientName, digest, appUrl, currency, actionUrls }: DigestEmailInput): { subject: string; text: string; html: string } {
  const base = appUrl.replace(/\/+$/, '')
  const groups = byHousehold(digest.reminders)
  const firstName = recipientName.split(' ')[0] || recipientName
  const actionFor = (r: Reminder) => actionUrls?.get(`${r.stage}:${r.item.key}`)

  // Plain text
  const lines: string[] = [`Hi ${firstName},`, '', 'These payments need doing by hand:', '']
  for (const g of groups) {
    if (groups.length > 1) lines.push(`${g.name}`)
    for (const r of g.reminders) {
      lines.push(`- ${r.item.label}: ${formatAmount(r.item.amount, currency)} — ${dueText(r)}`)
      const action = actionFor(r)
      if (action) lines.push(`  Mark as paid: ${action}`)
    }
    lines.push(`  Open the to-pay list: ${base}/households/${g.id}`, '')
  }
  lines.push(`Change or turn off these reminders: ${base}/profile`)
  const text = lines.join('\n')

  // HTML
  const row = (r: Reminder) => {
    const action = actionFor(r)
    const colour = r.stage === 'OVERDUE' ? '#b42318' : r.stage === 'DUE_TODAY' ? '#8a5a00' : '#475467'
    return `<tr>
      <td style="padding:8px 12px 8px 0;border-top:1px solid #e4e7ec;">${escapeHtml(r.item.label)}<br><span style="font-size:13px;color:${colour};">${escapeHtml(dueText(r))}</span></td>
      <td style="padding:8px 0;border-top:1px solid #e4e7ec;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(formatAmount(r.item.amount, currency))}${
        action ? `<br><a href="${escapeHtml(action)}" style="font-size:13px;color:#8a5a00;">Mark as paid</a>` : ''}</td>
    </tr>`
  }
  const sections = groups.map((g) => `
    ${groups.length > 1 ? `<h2 style="font-size:15px;margin:20px 0 4px;">${escapeHtml(g.name)}</h2>` : ''}
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;">${g.reminders.map(row).join('')}</table>
    <p style="margin:8px 0 0;"><a href="${escapeHtml(`${base}/households/${g.id}`)}" style="color:#8a5a00;">Open the to-pay list</a></p>`).join('')
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f7f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#101828;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:8px;padding:24px;">
    <p style="margin:0 0 4px;font-size:15px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 12px;font-size:15px;">These payments need doing by hand:</p>
    ${sections}
    <p style="margin:24px 0 0;font-size:12px;color:#667085;"><a href="${escapeHtml(`${base}/profile`)}" style="color:#667085;">Change or turn off these reminders</a></p>
  </div>
</body></html>`

  return { subject: digestSubject(digest.reminders), text, html }
}
