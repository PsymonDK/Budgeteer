import { Decimal } from '@prisma/client/runtime/client'
import { prisma, notDeleted } from './prisma'
import { effectiveCurrentMonth } from './budgetTransfer'
import { dueAmount, isListable } from './occurrences'
import { dueDateFor, recipientsFor, type ReminderItem } from './reminders'

const SEVERAL_A_MONTH = new Set(['WEEKLY', 'FORTNIGHTLY'])

/**
 * Unpaid manual items of the households' ACTIVE budget years that a reminder could be about:
 * PENDING manual expense and savings occurrences, and PENDING transfers of households that
 * make theirs by hand. Covers every month up to next month (next month's items can be due
 * soon at the end of this one); reminders.ts decides which are due. Pass `householdIds` to
 * limit it; omit it for every active household.
 */
export async function loadReminderItems(now: Date = new Date(), householdIds?: string[]): Promise<ReminderItem[]> {
  const budgetYears = await prisma.budgetYear.findMany({
    where: { status: 'ACTIVE', household: { isActive: true, ...(householdIds && { id: { in: householdIds } }) } },
    select: {
      id: true,
      year: true,
      household: {
        select: {
          id: true, name: true, transferPaymentMethod: true, transferDueDay: true,
          members: { where: { user: { isActive: true } }, select: { userId: true } },
        },
      },
    },
  })

  const entry = {
    select: {
      label: true, dueDay: true, frequency: true, ownership: true, ownedByUserId: true,
      customSplits: { select: { userId: true, pct: true } },
    },
  }

  const items: ReminderItem[] = []
  for (const by of budgetYears) {
    const current = effectiveCurrentMonth(by.year, now)
    if (current > 12) continue // a past year still ACTIVE: its months are history
    const months = { lte: Math.min(12, current + 1) }
    const household = by.household
    const memberIds = household.members.map((m) => m.userId)
    const base = { householdId: household.id, householdName: household.name, budgetYearId: by.id }

    const [expenseOccs, savingsOccs, transfers] = await Promise.all([
      prisma.expenseOccurrence.findMany({
        where: { expense: { budgetYearId: by.id, paymentMethod: 'MANUAL', ...notDeleted }, year: by.year, month: months, status: 'PENDING' },
        include: { expense: entry },
      }),
      prisma.savingsOccurrence.findMany({
        where: { savingsEntry: { budgetYearId: by.id, paymentMethod: 'MANUAL', ...notDeleted }, year: by.year, month: months, status: 'PENDING' },
        include: { savingsEntry: entry },
      }),
      household.transferPaymentMethod === 'MANUAL'
        ? prisma.budgetTransfer.findMany({ where: { budgetYearId: by.id, year: by.year, month: months, status: 'PENDING' } })
        : [],
    ])

    const dayOf = (e: { dueDay: number | null; frequency: string }) => (SEVERAL_A_MONTH.has(e.frequency) ? null : e.dueDay)
    for (const o of expenseOccs.filter(isListable)) {
      items.push({
        ...base, key: `expense:${o.id}`, kind: 'expense', label: o.expense.label, amount: dueAmount(o).toFixed(2),
        dueDate: dueDateFor(by.year, o.month, dayOf(o.expense)), recipientIds: recipientsFor(o.expense, memberIds),
      })
    }
    for (const o of savingsOccs.filter(isListable)) {
      items.push({
        ...base, key: `savings:${o.id}`, kind: 'savings', label: o.savingsEntry.label, amount: dueAmount(o).toFixed(2),
        dueDate: dueDateFor(by.year, o.month, dayOf(o.savingsEntry)), recipientIds: recipientsFor(o.savingsEntry, memberIds),
      })
    }
    for (const t of transfers) {
      items.push({
        ...base, key: `transfer:${t.id}`, kind: 'transfer', label: 'Transfer to the budget account',
        amount: new Decimal(t.calculatedAmount.toString()).toFixed(2),
        dueDate: dueDateFor(by.year, t.month, household.transferDueDay), recipientIds: memberIds,
      })
    }
  }
  return items
}
