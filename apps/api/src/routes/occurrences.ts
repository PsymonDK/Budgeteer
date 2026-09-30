import { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma, notDeleted } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertBudgetYearAccess } from '../lib/ownership'
import { effectiveCurrentMonth, recalculateTransfer } from '../lib/budgetTransfer'
import { dueAmount, isListable, occurrenceTotals, toOccurrenceItem, type OccurrenceItem, type OccurrenceKind } from '../lib/occurrences'
import { buildMonthPayments, occurrenceKey, type TrackedOccurrence } from '../lib/payments'

const MonthQuerySchema = z.object({ month: z.coerce.number().int().min(1).max(12).optional() })

// Items are paid in full or pending, or taken off the list (dismissed) with a reason.
// In Pay/No-pay, unpaid items carry over whole at rollover; dismissed ones don't.
export const UpdateOccurrenceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('PAID') }),
  z.object({ status: z.literal('PENDING') }),
  z.object({ status: z.literal('DISMISSED'), reason: z.enum(['PAID_ELSEWHERE', 'SKIPPED']) }),
])

const MarkAllPaidSchema = z.object({ month: z.number().int().min(1).max(12) })

const KindSchema = z.enum(['expense', 'savings'])

// The to-pay list: a month's manually paid expense and savings items, in every budget
// model. Members mark them paid one by one or all at once, or dismiss them. In Pay/No-pay
// unpaid items carry into the next month at rollover and automatic items are marked paid
// then; in Average / Forward-looking unpaid items stay on the list as overdue until
// ticked off or dismissed.
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

  // Manually paid entries only; automatic ones need no reminding
  const manual = { paymentMethod: 'MANUAL' as const }
  const entrySelect = { select: { id: true, label: true, category: { select: { name: true } } } }

  /** Manual items of a budget year matching `where` (month, status), without placeholder rows. */
  async function listItems(
    budgetYearId: string,
    year: number,
    where: { month: number | { lt: number }; status?: 'PENDING' },
  ): Promise<OccurrenceItem[]> {
    const [expenseOccs, savingsOccs] = await Promise.all([
      prisma.expenseOccurrence.findMany({
        where: { expense: { budgetYearId, ...notDeleted, ...manual }, year, ...where },
        include: { expense: entrySelect },
      }),
      prisma.savingsOccurrence.findMany({
        where: { savingsEntry: { budgetYearId, ...notDeleted, ...manual }, year, ...where },
        include: { savingsEntry: entrySelect },
      }),
    ])
    const items = [
      ...expenseOccs.filter(isListable).map((o) => toOccurrenceItem(o, 'expense', { id: o.expense.id, label: o.expense.label, categoryName: o.expense.category?.name ?? null })),
      ...savingsOccs.filter(isListable).map((o) => toOccurrenceItem(o, 'savings', { id: o.savingsEntry.id, label: o.savingsEntry.label, categoryName: o.savingsEntry.category?.name ?? null })),
    ]
    return items.sort((a, b) => a.month - b.month || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
  }

  /** Unpaid manual items from months before `month`: shown (and marked) with the current month. */
  const listOverdue = (budgetYearId: string, year: number, month: number) =>
    listItems(budgetYearId, year, { month: { lt: month }, status: 'PENDING' })

  // GET /budget-years/:id/occurrences?month=M — the month's manual items (defaults to the
  // current month), plus overdue ones from earlier months when M is the current month
  fastify.get('/budget-years/:id/occurrences', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = MonthQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: z.flattenError(query.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, false)
    if (!budgetYear) return

    const { budgetModel } = budgetYear.household
    const currentMonth = effectiveCurrentMonth(budgetYear.year)
    const month = query.data.month ?? Math.min(12, currentMonth)
    const payNoPay = budgetModel === 'PAY_NO_PAY'
    const automatic = { paymentMethod: 'AUTOMATIC' as const }
    const [items, overdue, automaticExpenses, automaticSavings, manualExpenses, manualSavings] = await Promise.all([
      listItems(id, budgetYear.year, { month }),
      month === currentMonth ? listOverdue(id, budgetYear.year, month) : [],
      // Only Pay/No-pay has rows for automatic items (marked paid at month close)
      payNoPay ? prisma.expenseOccurrence.count({ where: { expense: { budgetYearId: id, ...notDeleted, ...automatic }, year: budgetYear.year, month } }) : 0,
      payNoPay ? prisma.savingsOccurrence.count({ where: { savingsEntry: { budgetYearId: id, ...notDeleted, ...automatic }, year: budgetYear.year, month } }) : 0,
      prisma.expense.count({ where: { budgetYearId: id, ...manual } }),
      prisma.savingsEntry.count({ where: { budgetYearId: id, ...manual } }),
    ])

    return reply.send({
      budgetModel,
      year: budgetYear.year,
      month,
      isReadOnly: budgetYear.status === 'RETIRED',
      // Pay/No-pay carries unpaid items into the next month; the other models keep them as overdue
      carriesOver: payNoPay,
      items,
      overdue,
      totals: occurrenceTotals(items),
      // Pay/No-pay: automatically paid items this month, not listed above
      automaticCount: automaticExpenses + automaticSavings,
      // Manually paid entries in the budget year; with none (and nothing overdue) there's no list to show
      manualEntryCount: manualExpenses + manualSavings,
    })
  })

  // GET /budget-years/:id/payments?month=M — the month's expense and savings payments with their
  // due day, for the dashboard's payments timeline (any budget model). Manual items carry their
  // paid status in every model; in Pay/No-pay automatic items do too.
  fastify.get('/budget-years/:id/payments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = MonthQuerySchema.safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: z.flattenError(query.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, false)
    if (!budgetYear) return

    const month = query.data.month ?? Math.min(12, effectiveCurrentMonth(budgetYear.year))
    // Other models only track manual items; ignore rows left from an earlier Pay/No-pay period
    const trackedEntries = budgetYear.household.budgetModel === 'PAY_NO_PAY' ? {} : manual
    const category = { select: { name: true } }
    const [expenses, savings, expenseOccs, savingsOccs] = await Promise.all([
      prisma.expense.findMany({ where: { budgetYearId: id }, include: { category } }),
      prisma.savingsEntry.findMany({ where: { budgetYearId: id }, include: { category } }),
      prisma.expenseOccurrence.findMany({ where: { expense: { budgetYearId: id, ...notDeleted, ...trackedEntries }, year: budgetYear.year, month } }),
      prisma.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId: id, ...notDeleted, ...trackedEntries }, year: budgetYear.year, month } }),
    ])

    const tracked = (o: { status: TrackedOccurrence['status']; dismissReason: TrackedOccurrence['dismissReason']; scheduledAmount: Prisma.Decimal; carriedAmount: Prisma.Decimal }) =>
      ({ status: o.status, dismissReason: o.dismissReason, dueAmount: dueAmount(o) })
    const occurrences = new Map<string, TrackedOccurrence>([
      ...expenseOccs.filter(isListable).map((o) => [occurrenceKey('expense', o.expenseId), tracked(o)] as const),
      ...savingsOccs.filter(isListable).map((o) => [occurrenceKey('savings', o.savingsEntryId), tracked(o)] as const),
    ])

    const { items, totals } = buildMonthPayments({ year: budgetYear.year, month, expenses, savings, occurrences })
    return reply.send({ budgetModel: budgetYear.household.budgetModel, year: budgetYear.year, month, items, totals })
  })

  // PATCH /budget-years/:id/occurrences/:kind/:occurrenceId — mark one item paid or pending, or dismiss it
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
      ? await prisma.expenseOccurrence.findFirst({
        where: { id: occurrenceId, expense: { budgetYearId: id, ...notDeleted } },
        include: { expense: { select: { paymentMethod: true } } },
      })
      : await prisma.savingsOccurrence.findFirst({
        where: { id: occurrenceId, savingsEntry: { budgetYearId: id, ...notDeleted } },
        include: { savingsEntry: { select: { paymentMethod: true } } },
      })
    if (!occ) return reply.status(404).send({ error: 'Occurrence not found' })
    const paymentMethod = 'expense' in occ ? occ.expense.paymentMethod : occ.savingsEntry.paymentMethod
    if (paymentMethod === 'AUTOMATIC') {
      return reply.status(409).send({ error: 'This item is paid automatically, so there is nothing to tick off', code: 'OCCURRENCE_AUTOMATIC' })
    }
    if (occ.status === 'SKIPPED') {
      return reply.status(409).send({ error: 'This month is closed; its unpaid amount was carried to the next month', code: 'OCCURRENCE_CLOSED' })
    }

    const change = body.data
    const data = change.status === 'PAID'
      ? { status: 'PAID' as const, paidAt: new Date(), actualAmount: dueAmount(occ), dismissReason: null }
      : change.status === 'DISMISSED'
        ? { status: 'DISMISSED' as const, dismissReason: change.reason, paidAt: null, actualAmount: null }
        : { status: 'PENDING' as const, paidAt: null, actualAmount: null, dismissReason: null }

    if (kind === 'expense') await prisma.expenseOccurrence.update({ where: { id: occurrenceId }, data })
    else await prisma.savingsOccurrence.update({ where: { id: occurrenceId }, data })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    const items = await listItems(id, occ.year, { month: occ.month })
    return reply.send({ item: items.find((i) => i.id === occurrenceId) ?? null, totals: occurrenceTotals(items) })
  })

  // POST /budget-years/:id/occurrences/mark-all-paid — mark every pending manual item of a month
  // paid; for the current month that includes overdue items from earlier months
  fastify.post('/budget-years/:id/occurrences/mark-all-paid', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = MarkAllPaidSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid request body', details: z.flattenError(body.error) })

    const budgetYear = await loadBudgetYear(id, request, reply, true)
    if (!budgetYear) return

    const { month } = body.data
    const year = budgetYear.year
    const months = month === effectiveCurrentMonth(year) ? { lte: month } : month
    const paidAt = new Date()

    await prisma.$transaction(async (tx) => {
      const [expenseOccs, savingsOccs] = await Promise.all([
        tx.expenseOccurrence.findMany({ where: { expense: { budgetYearId: id, ...notDeleted, ...manual }, year, month: months, status: 'PENDING' } }),
        tx.savingsOccurrence.findMany({ where: { savingsEntry: { budgetYearId: id, ...notDeleted, ...manual }, year, month: months, status: 'PENDING' } }),
      ])
      for (const o of expenseOccs.filter(isListable)) {
        await tx.expenseOccurrence.update({ where: { id: o.id }, data: { status: 'PAID', paidAt, actualAmount: dueAmount(o) } })
      }
      for (const o of savingsOccs.filter(isListable)) {
        await tx.savingsOccurrence.update({ where: { id: o.id }, data: { status: 'PAID', paidAt, actualAmount: dueAmount(o) } })
      }
    })

    await recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    const items = await listItems(id, year, { month })
    return reply.send({ items, totals: occurrenceTotals(items) })
  })
}
