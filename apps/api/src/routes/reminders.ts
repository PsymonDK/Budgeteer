import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { loadReminderItems } from '../lib/reminderItems'
import { remindersFor, toISODate } from '../lib/reminders'
import { loadHouseholdSettings, loadSystemSettings, loadUserReminderSettings, resolveChannels } from '../lib/notificationSettings'

// In-app reminders: what the signed-in member pays by hand and should see now, across
// their households. Drives the navigation badge and the to-pay list's summary.
export async function reminderRoutes(fastify: FastifyInstance) {
  // GET /me/reminders — due soon (within the lead time), due today and overdue manual items,
  // for the households whose settings (and the member's and the install's) allow in-app reminders
  fastify.get('/me/reminders', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const now = new Date()
    const today = toISODate(now)

    const [user, memberships, system, userSettings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.householdMember.findMany({ where: { userId, household: { isActive: true } }, select: { householdId: true } }),
      loadSystemSettings(),
      loadUserReminderSettings([userId]),
    ])
    const householdIds = memberships.map((m) => m.householdId)
    const [items, households] = householdIds.length > 0
      ? await Promise.all([loadReminderItems(now, householdIds), loadHouseholdSettings(householdIds)])
      : [[], new Map()]

    const prefs = userSettings.get(userId)!
    const resolvedFor = (householdId: string) => resolveChannels(system, households.get(householdId)!, prefs, user?.email ?? '')
    const visible = items.filter((i) => resolvedFor(i.householdId).inApp)
    const reminders = remindersFor(userId, visible, today, (i) => resolvedFor(i.householdId).leadDays, 'current')
    const count = (stage: string) => reminders.filter((r) => r.stage === stage).length

    return reply.send({
      date: today,
      reminders: reminders.map(({ item, stage, daysUntilDue }) => ({
        key: item.key,
        kind: item.kind,
        label: item.label,
        amount: item.amount,
        dueDate: item.dueDate,
        stage,
        daysUntilDue,
        leadDays: resolvedFor(item.householdId).leadDays,
        householdId: item.householdId,
        householdName: item.householdName,
        budgetYearId: item.budgetYearId,
      })),
      counts: { overdue: count('OVERDUE'), dueToday: count('DUE_TODAY'), dueSoon: count('DUE_SOON'), total: reminders.length },
    })
  })
}
