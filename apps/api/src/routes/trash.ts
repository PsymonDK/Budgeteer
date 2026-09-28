import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertHouseholdAccess } from '../lib/ownership'
import { recalculateTransfer } from '../lib/budgetTransfer'
import { recalculateSalaryDeductions } from './jobs'

// Deleting expenses, savings and income records moves them to a trash instead of
// removing them (financial data is never hard-deleted). These routes list trashed
// items and restore them. There is no "empty trash".

const TRASHED = { deletedAt: { not: null } }
const deletedBy = { select: { id: true, name: true } } as const

const HouseholdKind = z.enum(['expense', 'savings'])
const IncomeKind = z.enum(['salary', 'override', 'bonus', 'taxcard'])

type BudgetYearRef = { id: string; year: number; status: string; simulationName: string | null }

function yearRef(by: BudgetYearRef) {
  return { id: by.id, year: by.year, status: by.status, simulationName: by.simulationName }
}

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, ...deletedBy })
  return new Map(users.map((u) => [u.id, u.name]))
}

export async function trashRoutes(fastify: FastifyInstance) {
  // ── Household trash: expenses and savings entries ──────────────────────────

  // GET /households/:id/trash
  fastify.get('/households/:id/trash', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const budgetYearSelect = { select: { id: true, year: true, status: true, simulationName: true } } as const
    const [expenses, savings] = await Promise.all([
      prisma.expense.findMany({
        where: { ...TRASHED, budgetYear: { householdId } },
        include: { budgetYear: budgetYearSelect, category: { select: { name: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.savingsEntry.findMany({
        where: { ...TRASHED, budgetYear: { householdId } },
        include: { budgetYear: budgetYearSelect, category: { select: { name: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
    ])
    const names = await userNames([...expenses, ...savings].map((e) => e.deletedByUserId))

    const items = [
      ...expenses.map((e) => ({ kind: 'expense' as const, entry: e })),
      ...savings.map((s) => ({ kind: 'savings' as const, entry: s })),
    ]
      .map(({ kind, entry }) => ({
        kind,
        id: entry.id,
        label: entry.label,
        categoryName: entry.category?.name ?? null,
        amount: (entry.originalAmount ?? entry.amount).toString(),
        currencyCode: entry.currencyCode,
        frequency: entry.frequency,
        monthlyEquivalent: entry.monthlyEquivalent.toString(),
        budgetYear: yearRef(entry.budgetYear),
        deletedAt: entry.deletedAt!.toISOString(),
        deletedBy: entry.deletedByUserId ? { id: entry.deletedByUserId, name: names.get(entry.deletedByUserId) ?? null } : null,
        // Retired years are read-only, so their trashed entries stay in the trash
        canRestore: entry.budgetYear.status !== 'RETIRED',
      }))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))

    return reply.send(items)
  })

  // POST /households/:id/trash/:kind/:itemId/restore
  fastify.post('/households/:id/trash/:kind/:itemId/restore', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId, kind: rawKind, itemId } = request.params as { id: string; kind: string; itemId: string }
    const { sub: userId, role } = request.user
    const kind = HouseholdKind.safeParse(rawKind)
    if (!kind.success) return reply.status(404).send({ error: 'Item not found' })
    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const where = { id: itemId, ...TRASHED, budgetYear: { householdId } }
    const entry = kind.data === 'expense'
      ? await prisma.expense.findFirst({ where, include: { budgetYear: true } })
      : await prisma.savingsEntry.findFirst({ where, include: { budgetYear: true } })
    if (!entry) return reply.status(404).send({ error: 'Item not found in trash' })
    if (entry.budgetYear.status === 'RETIRED') {
      return reply.status(400).send({ error: 'Retired budget years are read-only', code: 'BUDGET_YEAR_READ_ONLY' })
    }

    const restore = { deletedAt: null, deletedByUserId: null }
    if (kind.data === 'expense') await prisma.expense.update({ where: { id: itemId }, data: restore })
    else await prisma.savingsEntry.update({ where: { id: itemId }, data: restore })

    await recalculateTransfer(entry.budgetYearId).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))
    return reply.send({ kind: kind.data, id: itemId, budgetYearId: entry.budgetYearId })
  })

  // ── Income trash: salary records, overrides, bonuses, tax cards ────────────

  // GET /users/:id/income/trash — the user's own, or a proxy user's for admins/bookkeepers
  fastify.get('/users/:id/income/trash', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId } = request.params as { id: string }
    if (!await canManageIncome(targetUserId, request.user.sub, request.user.role)) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const job = { select: { id: true, name: true } } as const
    const byUser = { ...TRASHED, job: { userId: targetUserId } }
    const [salaries, overrides, bonuses, taxCards] = await Promise.all([
      prisma.salaryRecord.findMany({ where: byUser, include: { job } }),
      prisma.monthlyIncomeOverride.findMany({ where: byUser, include: { job } }),
      prisma.bonus.findMany({ where: byUser, include: { job } }),
      prisma.taxCardSettings.findMany({ where: byUser, include: { job } }),
    ])
    const names = await userNames([...salaries, ...overrides, ...bonuses, ...taxCards].map((r) => r.deletedByUserId))
    const base = (r: { id: string; job: { id: string; name: string }; deletedAt: Date | null; deletedByUserId: string | null }) => ({
      id: r.id,
      job: r.job,
      deletedAt: r.deletedAt!.toISOString(),
      deletedBy: r.deletedByUserId ? { id: r.deletedByUserId, name: names.get(r.deletedByUserId) ?? null } : null,
    })

    const items = [
      ...salaries.map((r) => ({ ...base(r), kind: 'salary' as const, label: `Salary from ${r.effectiveFrom.toISOString().slice(0, 10)}`, grossAmount: r.grossAmount.toString(), netAmount: r.netAmount.toString(), currencyCode: r.currencyCode })),
      ...overrides.map((r) => ({ ...base(r), kind: 'override' as const, label: `Override ${r.year}-${String(r.month).padStart(2, '0')}`, grossAmount: r.grossAmount.toString(), netAmount: r.netAmount.toString(), currencyCode: null })),
      ...bonuses.map((r) => ({ ...base(r), kind: 'bonus' as const, label: r.label, grossAmount: r.grossAmount.toString(), netAmount: r.netAmount.toString(), currencyCode: r.currencyCode })),
      ...taxCards.map((r) => ({ ...base(r), kind: 'taxcard' as const, label: `Tax card from ${r.effectiveFrom.toISOString().slice(0, 10)}`, grossAmount: null, netAmount: null, currencyCode: null })),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))

    return reply.send(items)
  })

  // POST /users/:id/income/trash/:kind/:itemId/restore
  fastify.post('/users/:id/income/trash/:kind/:itemId/restore', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetUserId, kind: rawKind, itemId } = request.params as { id: string; kind: string; itemId: string }
    const kind = IncomeKind.safeParse(rawKind)
    if (!kind.success) return reply.status(404).send({ error: 'Item not found' })
    if (!await canManageIncome(targetUserId, request.user.sub, request.user.role)) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const where = { id: itemId, ...TRASHED, job: { userId: targetUserId } }
    const restore = { deletedAt: null, deletedByUserId: null }
    let jobId: string | null = null
    switch (kind.data) {
      case 'salary': {
        const r = await prisma.salaryRecord.findFirst({ where })
        if (r) { await prisma.salaryRecord.update({ where: { id: itemId }, data: restore }); jobId = r.jobId }
        break
      }
      case 'override': {
        const r = await prisma.monthlyIncomeOverride.findFirst({ where })
        if (r) { await prisma.monthlyIncomeOverride.update({ where: { id: itemId }, data: restore }); jobId = r.jobId }
        break
      }
      case 'bonus': {
        const r = await prisma.bonus.findFirst({ where })
        if (r) { await prisma.bonus.update({ where: { id: itemId }, data: restore }); jobId = r.jobId }
        break
      }
      case 'taxcard': {
        const r = await prisma.taxCardSettings.findFirst({ where })
        if (r) {
          await prisma.taxCardSettings.update({ where: { id: itemId }, data: restore })
          jobId = r.jobId
          // Deductions calculated from tax cards depend on which cards are live
          const owner = await prisma.job.findUniqueOrThrow({ where: { id: r.jobId }, select: { country: true } })
          await recalculateSalaryDeductions(r.jobId, owner.country).catch((err) => fastify.log.error({ err }, 'recalculateSalaryDeductions failed'))
        }
        break
      }
    }
    if (!jobId) return reply.status(404).send({ error: 'Item not found in trash' })

    return reply.send({ kind: kind.data, id: itemId, jobId })
  })
}

/** Same rule as editing income: yourself, or a proxy user as system admin/bookkeeper. */
async function canManageIncome(targetUserId: string, requesterId: string, requesterRole: string): Promise<boolean> {
  if (targetUserId === requesterId) return true
  if (requesterRole !== 'SYSTEM_ADMIN' && requesterRole !== 'BOOKKEEPER') return false
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { isProxy: true } })
  return !!target?.isProxy
}
