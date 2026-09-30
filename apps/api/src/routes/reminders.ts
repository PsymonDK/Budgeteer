import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { loadReminderItems } from '../lib/reminderItems'
import { DEFAULT_LEAD_DAYS, remindersFor, toISODate } from '../lib/reminders'

// In-app reminders: what the signed-in member pays by hand and should see now, across
// their households. Drives the navigation badge and the to-pay list's summary.
export async function reminderRoutes(fastify: FastifyInstance) {
  // GET /me/reminders — due soon (within the lead time), due today and overdue manual items
  fastify.get('/me/reminders', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const now = new Date()

    const memberships = await prisma.householdMember.findMany({
      where: { userId, household: { isActive: true } },
      select: { householdId: true },
    })
    const items = memberships.length > 0 ? await loadReminderItems(now, memberships.map((m) => m.householdId)) : []

    // Per-member lead days come with the notification settings (#260)
    const reminders = remindersFor(userId, items, toISODate(now), DEFAULT_LEAD_DAYS, 'current')
    const count = (stage: string) => reminders.filter((r) => r.stage === stage).length

    return reply.send({
      date: toISODate(now),
      leadDays: DEFAULT_LEAD_DAYS,
      reminders: reminders.map(({ item, stage, daysUntilDue }) => ({
        key: item.key,
        kind: item.kind,
        label: item.label,
        amount: item.amount,
        dueDate: item.dueDate,
        stage,
        daysUntilDue,
        householdId: item.householdId,
        householdName: item.householdName,
        budgetYearId: item.budgetYearId,
      })),
      counts: { overdue: count('OVERDUE'), dueToday: count('DUE_TODAY'), dueSoon: count('DUE_SOON'), total: reminders.length },
    })
  })
}
