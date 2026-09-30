import { prisma } from './prisma'
import { daysInMonth } from './payments'

/**
 * Which of a budget year's transfers an automatic (standing-order) transfer has already
 * covered by `today`: every PENDING month before the current one, and the current month
 * once its due day has come (days past the month's end fall on its last day).
 */
export function planTransferAutoPay(
  transfers: { id: string; year: number; month: number; status: string }[],
  dueDay: number,
  today: Date,
): string[] {
  const todayYm = today.getFullYear() * 12 + today.getMonth() + 1
  return transfers
    .filter((t) => {
      if (t.status !== 'PENDING') return false
      const ym = t.year * 12 + t.month
      if (ym < todayYm) return true
      if (ym > todayYm) return false
      return today.getDate() >= Math.min(dueDay, daysInMonth(t.year, t.month))
    })
    .map((t) => t.id)
}

/**
 * Marks automatic transfers paid at their planned amount once their due day has come, in
 * each household's ACTIVE budget year. Runs daily and at startup (catching up after
 * downtime), and when a household switches its transfer to automatic. Pass `householdId`
 * to limit it to one household. Returns how many transfers were marked.
 */
export async function runTransferAutoPay(now: Date = new Date(), householdId?: string): Promise<number> {
  const budgetYears = await prisma.budgetYear.findMany({
    where: {
      status: 'ACTIVE',
      household: { isActive: true, transferPaymentMethod: 'AUTOMATIC', ...(householdId && { id: householdId }) },
    },
    select: {
      id: true,
      household: { select: { transferDueDay: true } },
      transfers: { where: { status: 'PENDING' }, select: { id: true, year: true, month: true, status: true, calculatedAmount: true } },
    },
  })

  let marked = 0
  for (const by of budgetYears) {
    const ids = new Set(planTransferAutoPay(by.transfers, by.household.transferDueDay, now))
    for (const t of by.transfers.filter((t) => ids.has(t.id))) {
      // Only still-PENDING rows, in case a member marked it meanwhile
      const { count } = await prisma.budgetTransfer.updateMany({
        where: { id: t.id, status: 'PENDING' },
        data: { status: 'PAID', actualAmount: t.calculatedAmount, paidAt: now },
      })
      marked += count
    }
  }
  return marked
}
