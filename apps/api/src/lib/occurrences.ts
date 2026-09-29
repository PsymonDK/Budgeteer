import { Decimal } from '@prisma/client/runtime/client'

export type OccurrenceKind = 'expense' | 'savings'

export interface OccurrenceRow {
  id: string
  status: 'PENDING' | 'PAID' | 'SKIPPED'
  scheduledAmount: Decimal
  carriedAmount: Decimal
  actualAmount: Decimal | null
  paidAt: Date | null
}

export interface OccurrenceItem {
  id: string
  kind: OccurrenceKind
  entryId: string
  label: string
  categoryName: string | null
  status: 'PENDING' | 'PAID' | 'SKIPPED'
  scheduledAmount: string
  carriedAmount: string
  dueAmount: string
  actualAmount: string | null
  paidAt: string | null
}

/** Amount due for an occurrence this month: its own schedule plus unpaid carry-over. */
export function dueAmount(occ: Pick<OccurrenceRow, 'scheduledAmount' | 'carriedAmount'>): Decimal {
  return new Decimal(occ.scheduledAmount.toString()).add(new Decimal(occ.carriedAmount.toString()))
}

export function toOccurrenceItem(
  occ: OccurrenceRow,
  kind: OccurrenceKind,
  entry: { id: string; label: string; categoryName: string | null },
): OccurrenceItem {
  return {
    id: occ.id,
    kind,
    entryId: entry.id,
    label: entry.label,
    categoryName: entry.categoryName,
    status: occ.status,
    scheduledAmount: new Decimal(occ.scheduledAmount.toString()).toFixed(2),
    carriedAmount: new Decimal(occ.carriedAmount.toString()).toFixed(2),
    dueAmount: dueAmount(occ).toFixed(2),
    actualAmount: occ.actualAmount ? new Decimal(occ.actualAmount.toString()).toFixed(2) : null,
    paidAt: occ.paidAt ? occ.paidAt.toISOString() : null,
  }
}

/**
 * Month totals for display. `unpaid` is what would carry to next month if the month
 * closed now: each PENDING item's due amount less anything already paid on it.
 */
export function occurrenceTotals(items: OccurrenceItem[]): { due: string; paid: string; unpaid: string } {
  let due = new Decimal(0)
  let paid = new Decimal(0)
  let unpaid = new Decimal(0)
  for (const item of items) {
    if (item.status === 'SKIPPED') continue
    const itemDue = new Decimal(item.dueAmount)
    const itemPaid = item.actualAmount ? new Decimal(item.actualAmount) : new Decimal(0)
    due = due.add(itemDue)
    paid = paid.add(itemPaid)
    if (item.status === 'PENDING') {
      const remaining = itemDue.sub(itemPaid)
      if (remaining.gt(0)) unpaid = unpaid.add(remaining)
    }
  }
  return { due: due.toFixed(2), paid: paid.toFixed(2), unpaid: unpaid.toFixed(2) }
}
