import { BudgetStatus } from '@prisma/client'
import { prisma } from './prisma'
import { recalculateTransfer } from './budgetTransfer'

/**
 * The status a regular budget year should move to as the calendar advances, or null
 * to leave it. Past years retire, the current year's FUTURE year becomes ACTIVE, and
 * a future year that is ACTIVE ahead of time (older simulation promotes did this)
 * goes back to FUTURE. RETIRED years stay retired (an admin may have retired one on
 * purpose; restoring is a manual action) and simulations are never touched.
 */
export function nextBudgetStatus(status: BudgetStatus, year: number, currentYear: number): BudgetStatus | null {
  if (status === 'SIMULATION' || status === 'RETIRED') return null
  if (year < currentYear) return 'RETIRED'
  if (year === currentYear && status === 'FUTURE') return 'ACTIVE'
  if (year > currentYear && status === 'ACTIVE') return 'FUTURE'
  return null
}

/**
 * Applies calendar-driven status changes to every regular budget year. Idempotent,
 * so it runs at startup, daily, and before the monthly automations.
 * Returns the ids of years that became ACTIVE (their transfers need calculating).
 */
export async function advanceBudgetYearStatuses(now: Date = new Date()): Promise<string[]> {
  const currentYear = now.getFullYear()
  const years = await prisma.budgetYear.findMany({
    where: { status: { in: ['ACTIVE', 'FUTURE'] } },
    select: { id: true, year: true, status: true },
  })

  const byStatus: Record<'RETIRED' | 'ACTIVE' | 'FUTURE', string[]> = { RETIRED: [], ACTIVE: [], FUTURE: [] }
  for (const by of years) {
    const next = nextBudgetStatus(by.status, by.year, currentYear)
    if (next === 'RETIRED' || next === 'ACTIVE' || next === 'FUTURE') byStatus[next].push(by.id)
  }
  if (byStatus.RETIRED.length + byStatus.ACTIVE.length + byStatus.FUTURE.length === 0) return []

  // Regular years are unique per household and calendar year, so after this each
  // household has at most one ACTIVE year: the current one.
  await prisma.$transaction(
    (['RETIRED', 'FUTURE', 'ACTIVE'] as const).map((status) =>
      prisma.budgetYear.updateMany({ where: { id: { in: byStatus[status] } }, data: { status } }),
    ),
  )

  return byStatus.ACTIVE
}

/** Advances statuses and calculates transfers for any year that just became ACTIVE. */
export async function runBudgetYearLifecycle(now: Date = new Date()): Promise<number> {
  const activated = await advanceBudgetYearStatuses(now)
  for (const id of activated) await recalculateTransfer(id)
  return activated.length
}
