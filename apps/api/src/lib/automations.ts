import { AutomationTrigger } from '@prisma/client'
import { prisma } from './prisma'
import { recalculateTransfer, rolloverPayNoPayOccurrences } from './budgetTransfer'

export async function runAutomation(
  automationId: string,
  triggeredBy: AutomationTrigger,
  userId?: string,
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
    const [activeBudgetYear, household] = await Promise.all([
      prisma.budgetYear.findFirst({ where: { householdId: automation.householdId, status: 'ACTIVE' } }),
      prisma.household.findUnique({ where: { id: automation.householdId }, select: { autoMarkTransferPaid: true, budgetModel: true } }),
    ])

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

    const now = new Date()
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth() // getMonth() is 0-indexed; prev month is 1-indexed
    const currentMonth = now.getMonth() + 1
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const currentYear = now.getFullYear()

    if (household?.autoMarkTransferPaid) {
      const prevTransfer = await prisma.budgetTransfer.findUnique({
        where: { budgetYearId_month_year: { budgetYearId: activeBudgetYear.id, month: prevMonth, year: prevYear } },
      })
      if (prevTransfer && prevTransfer.status === 'PENDING') {
        await prisma.budgetTransfer.update({
          where: { id: prevTransfer.id },
          data: { status: 'PAID', actualAmount: prevTransfer.calculatedAmount, paidAt: now },
        })
      }
    }

    if (household?.budgetModel === 'PAY_NO_PAY') {
      await rolloverPayNoPayOccurrences(activeBudgetYear.id, currentYear, prevMonth, currentMonth)
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
  await Promise.all(automations.map((a) => runAutomation(a.id, triggeredBy, userId)))
  return automations.length
}
