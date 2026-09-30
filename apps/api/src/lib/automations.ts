import { AutomationTrigger } from '@prisma/client'
import { prisma } from './prisma'
import { closePayNoPayMonth, recalculateTransfer, rolloverPayNoPayOccurrences } from './budgetTransfer'
import { advanceBudgetYearStatuses } from './budgetYearLifecycle'

/** Previous calendar month (1-12) and its year, relative to now. */
export function previousMonth(now: Date): { year: number; month: number } {
  const month = now.getMonth() + 1
  return month === 1 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: month - 1 }
}

export async function runAutomation(
  automationId: string,
  triggeredBy: AutomationTrigger,
  userId?: string,
  options: { skipLifecycle?: boolean } = {},
): Promise<void> {
  const startedAt = new Date()

  const automation = await prisma.automation.findUnique({ where: { id: automationId } })
  if (!automation) return

  if (!automation.isEnabled) {
    const finishedAt = new Date()
    await prisma.automationRun.create({
      data: { automationId, triggeredBy, triggeredByUserId: userId ?? null, startedAt, finishedAt, status: 'SKIPPED', message: 'Automation is disabled' },
    })
    await prisma.automation.update({
      where: { id: automationId },
      data: { lastRunAt: finishedAt, lastRunStatus: 'SKIPPED' },
    })
    return
  }

  try {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const prev = previousMonth(now)

    const household = await prisma.household.findUnique({
      where: { id: automation.householdId },
      select: { budgetModel: true },
    })

    // Finalize last month in the budget year that owns it. On January 1st that is
    // last year's budget year, not the one that is ACTIVE now.
    const prevBudgetYear = await prisma.budgetYear.findFirst({
      where: { householdId: automation.householdId, year: prev.year, status: { not: 'SIMULATION' } },
    })
    // Automatic transfers are marked paid on their due day by the daily job (lib/transferAutoPay)
    if (prevBudgetYear && household?.budgetModel === 'PAY_NO_PAY' && prev.year !== currentYear) {
      // Year boundary: close December. Unpaid items can't carry into the new year
      // because its expenses are separate rows (copies), so they end here.
      await closePayNoPayMonth(prevBudgetYear.id, prev.year, prev.month)
    }

    if (!options.skipLifecycle) await advanceBudgetYearStatuses(now)

    const activeBudgetYear = await prisma.budgetYear.findFirst({
      where: { householdId: automation.householdId, status: 'ACTIVE' },
    })

    if (!activeBudgetYear) {
      const finishedAt = new Date()
      await prisma.automationRun.create({
        data: { automationId, triggeredBy, triggeredByUserId: userId ?? null, startedAt, finishedAt, status: 'SKIPPED', message: 'No active budget year found' },
      })
      await prisma.automation.update({
        where: { id: automationId },
        data: { lastRunAt: finishedAt, lastRunStatus: 'SKIPPED' },
      })
      return
    }

    if (household?.budgetModel === 'PAY_NO_PAY' && prev.year === currentYear && activeBudgetYear.year === currentYear) {
      await rolloverPayNoPayOccurrences(activeBudgetYear.id, currentYear, prev.month, currentMonth)
    }

    await recalculateTransfer(activeBudgetYear.id)

    const finishedAt = new Date()
    await prisma.automationRun.create({
      data: { automationId, triggeredBy, triggeredByUserId: userId ?? null, startedAt, finishedAt, status: 'SUCCESS' },
    })
    await prisma.automation.update({
      where: { id: automationId },
      data: { lastRunAt: finishedAt, lastRunStatus: 'SUCCESS' },
    })
  } catch (err) {
    const finishedAt = new Date()
    const message = err instanceof Error ? err.message : String(err)
    await prisma.automationRun.create({
      data: { automationId, triggeredBy, triggeredByUserId: userId ?? null, startedAt, finishedAt, status: 'ERROR', message },
    })
    await prisma.automation.update({
      where: { id: automationId },
      data: { lastRunAt: finishedAt, lastRunStatus: 'ERROR' },
    })
  }
}

export async function runAllEnabledAutomations(
  triggeredBy: AutomationTrigger,
  userId?: string,
): Promise<number> {
  const automations = await prisma.automation.findMany({ where: { isEnabled: true } })
  // Advance budget-year statuses once up front instead of once per household
  await advanceBudgetYearStatuses()
  await Promise.all(automations.map((a) => runAutomation(a.id, triggeredBy, userId, { skipLifecycle: true })))
  return automations.length
}
