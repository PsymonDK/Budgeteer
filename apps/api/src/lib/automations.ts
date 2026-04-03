import { AutomationTrigger } from '@prisma/client'
import { prisma } from './prisma'
import { recalculateTransfer } from './budgetTransfer'

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
