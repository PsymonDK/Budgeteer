import { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma, notDeleted } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertBudgetYearAccess } from '../lib/ownership'
import { effectiveCurrentMonth, recalculateTransfer } from '../lib/budgetTransfer'
import { dueAmount, occurrenceTotals, toOccurrenceItem, type OccurrenceItem, type OccurrenceKind } from '../lib/occurrences'
import { buildMonthPayments, occurrenceKey, type TrackedOccurrence } from '../lib/payments'

const MonthQuerySchema = z.object({ month: z.coerce.number().int().min(1).max(12).optional() })

// Items are paid in full or pending; unpaid items carry over whole at rollover
const UpdateOccurrenceSchema = z.object({ status: z.enum(['PAID', 'PENDING']) })

const MarkAllPaidSchema = z.object({ month: z.number().int().min(1).max(12) })

const KindSchema = z.enum(['expense', 'savings'])

// PAY_NO_PAY households track each expense/savings item per month. These routes let
// members see a month's items and mark them paid one by one or all at once; unpaid
// items carry into the next month at rollover.
export async function occurrenceRoutes(fastify: FastifyInstance) {
  async function loadBudgetYear(id: string, request: { user: { sub: string; role: string } }, reply: FastifyReply, forWrite: boolean) {
    const budgetYear = await assertBudgetYearAccess(id, request.user.sub, request.user.role === 'SYSTEM_ADMIN')
    if (!budgetYear) {
      reply.status(403).send({ error: 'Forbidden' })
      return null
    }
    if (forWrite && budgetYear.status === 'RETIRED') {
      reply.status(400).send({ error: 'Retired budget years are read-only', code: 'BUDGET_YEAR_READ_ONLY' })
      return null
    }
    return budgetYear
  }

  async function listItems(budgetYearId: string, year: number, month: number): Promise<OccurrenceItem[]> {
    const [expenseOccs, savingsOccs] = await Promise.all([
      prisma.expenseOccurrence.findMany({
        where: { expense: { budgetYearId, ...notDeleted }, year, month },
        include: { expense: { select: { id: true, label: true, category: { select: { name: true } } } } },
      }),
      prisma.savingsOccurrence.findMany({
        where: { savingsEntry: { budgetYearId, ...notDeleted }, year, month },
        include: { savingsEntry: { select: { id: true, label: true, category: { select: { name: true } } } } },
      }),
    ])
    const items = [
      ...expenseOccs.map((o) => toOccurrenceItem(o, 'expense', { id: o.expense.id, label: o.expense.label, categoryName: o.expense.category?.name ?? null })),
      ...savingsOccs.map((o) => toOccurrenceItem(o, 'savings', { id: o.savingsEntry.id, label: o.savingsEntry.label, categoryName: o.savingsEntry.category?.name ?? null })),
    ]
    return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
  }

  // GET /budget-years/:id/occurrences?month=M — the month's items (defaults to the current month)
  fastify.get('/budget-years/:id/occurrences', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = MonthQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: z.flattenError(query.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, false)
    if (!budgetYear) return

    const month = query.data.month ?? Math.min(12, effectiveCurrentMonth(budgetYear.year))
    const items = await listItems(id, budgetYear.year, month)

    return reply.send({
      budgetModel: budgetYear.household.budgetModel,
      year: budgetYear.year,
      month,
      isReadOnly: budgetYear.status === 'RETIRED',
      items,
      totals: occurrenceTotals(items),
    })
  })

  // GET /budget-years/:id/payments?month=M — the month's expense and savings payments with their
  // due day, for the dashboard's payments timeline (any budget model; paid status for Pay/No-pay)
  fastify.get('/budget-years/:id/payments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = MonthQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: z.flattenError(query.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, false)
    if (!budgetYear) return

    const month = query.data.month ?? Math.min(12, effectiveCurrentMonth(budgetYear.year))
    const tracked = budgetYear.household.budgetModel === 'PAY_NO_PAY'
    const category = { select: { name: true } }
    const [expenses, savings, expenseOccs, savingsOccs] = await Promise.all([
      prisma.expense.findMany({ where: { budgetYearId: id }, include: { category } }),
      prisma.savingsEntry.findMany({ where: { budgetYearId: id }, include: { category } }),
      tracked
        ? prisma.expenseOccurrence.findMany({ where: { expense: { budgetYearId: id, ...notDeleted }, year: budgetYear.year, month } })
        : [],
      tracked
        ? prisma.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId: id, ...notDeleted }, year: budgetYear.year, month } })
        : [],
    ])

    const occurrences = tracked
      ? new Map<string, TrackedOccurrence>([
        ...expenseOccs.map((o) => [occurrenceKey('expense', o.expenseId), { status: o.status, dueAmount: dueAmount(o) }] as const),
        ...savingsOccs.map((o) => [occurrenceKey('savings', o.savingsEntryId), { status: o.status, dueAmount: dueAmount(o) }] as const),
      ])
      : null

    const { items, totals } = buildMonthPayments({ year: budgetYear.year, month, expenses, savings, occurrences })
    return reply.send({ budgetModel: budgetYear.household.budgetModel, year: budgetYear.year, month, tracked, items, totals })
  })

  // PATCH /budget-years/:id/occurrences/:kind/:occurrenceId — mark one item paid or pending
  fastify.patch('/budget-years/:id/occurrences/:kind/:occurrenceId', { preHandler: authenticate }, async (request, reply) => {
    const { id, kind: rawKind, occurrenceId } = request.params as { id: string; kind: string; occurrenceId: string }
    const kindResult = KindSchema.safeParse(rawKind)
    if (!kindResult.success) return reply.status(404).send({ error: 'Occurrence not found' })
    const kind: OccurrenceKind = kindResult.data

    const body = UpdateOccurrenceSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(body.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, true)
    if (!budgetYear) return

    const occ = kind === 'expense'
      ? await prisma.expenseOccurrence.findFirst({ where: { id: occurrenceId, expense: { budgetYearId: id, ...notDeleted } } })
      : await prisma.savingsOccurrence.findFirst({ where: { id: occurrenceId, savingsEntry: { budgetYearId: id, ...notDeleted } } })
    if (!occ) return reply.status(404).send({ error: 'Occurrence not found' })
    if (occ.status === 'SKIPPED') {
      return reply.status(409).send({ error: 'This month is closed; its unpaid amount was carried to the next month', code: 'OCCURRENCE_CLOSED' })
    }

    const data = body.data.status === 'PAID'
      ? { status: 'PAID' as const, paidAt: new Date(), actualAmount: dueAmount(occ) }
      : { status: 'PENDING' as const, paidAt: null, actualAmount: null }

    if (kind === 'expense') await prisma.expenseOccurrence.update({ where: { id: occurrenceId }, data })
    else await prisma.savingsOccurrence.update({ where: { id: occurrenceId }, data })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    const items = await listItems(id, occ.year, occ.month)
    return reply.send({ item: items.find((i) => i.id === occurrenceId) ?? null, totals: occurrenceTotals(items) })
  })

  // POST /budget-years/:id/occurrences/mark-all-paid — mark every pending item of a month paid
  fastify.post('/budget-years/:id/occurrences/mark-all-paid', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = MarkAllPaidSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(body.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, true)
    if (!budgetYear) return

    const { month } = body.data
    const year = budgetYear.year
    const paidAt = new Date()

    await prisma.$transaction(async (tx) => {
      const [expenseOccs, savingsOccs] = await Promise.all([
        tx.expenseOccurrence.findMany({ where: { expense: { budgetYearId: id, ...notDeleted }, year, month, status: 'PENDING' } }),
        tx.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId: id, ...notDeleted }, year, month, status: 'PENDING' } }),
      ])
      for (const o of expenseOccs) {
        await tx.expenseOccurrence.update({ where: { id: o.id }, data: { status: 'PAID', paidAt, actualAmount: dueAmount(o) } })
      }
      for (const o of savingsOccs) {
        await tx.savingsOccurrence.update({ where: { id: o.id }, data: { status: 'PAID', paidAt, actualAmount: dueAmount(o) } })
      }
    })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    const items = await listItems(id, year, month)
    return reply.send({ items, totals: occurrenceTotals(items) })
  })
}
