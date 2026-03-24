import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'

export async function compareRoutes(fastify: FastifyInstance) {
  // GET /households/:id/compare?a=budgetYearIdA&b=budgetYearIdB
  fastify.get('/households/:id/compare', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { a: yearIdA, b: yearIdB } = request.query as { a?: string; b?: string }
    const { sub: userId, role } = request.user

    // Auth
    if (role !== 'SYSTEM_ADMIN') {
      const member = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    if (!yearIdA || !yearIdB) {
      return reply.status(400).send({ error: 'Query params a and b (budget year IDs) are required' })
    }

    // Load both budget years (must belong to this household)
    const [yearA, yearB] = await Promise.all([
      prisma.budgetYear.findFirst({ where: { id: yearIdA, householdId } }),
      prisma.budgetYear.findFirst({ where: { id: yearIdB, householdId } }),
    ])

    if (!yearA) return reply.status(404).send({ error: 'Budget year A not found' })
    if (!yearB) return reply.status(404).send({ error: 'Budget year B not found' })

    // Load expenses for both years
    const [expensesA, expensesB] = await Promise.all([
      prisma.expense.findMany({
        where: { budgetYearId: yearIdA },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
      }),
      prisma.expense.findMany({
        where: { budgetYearId: yearIdB },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
      }),
    ])

    // Load savings for both years
    const [savingsA, savingsB] = await Promise.all([
      prisma.savingsEntry.findMany({ where: { budgetYearId: yearIdA } }),
      prisma.savingsEntry.findMany({ where: { budgetYearId: yearIdB } }),
    ])

    // Income: sum allocations for each budget year
    const [allocsA, allocsB] = await Promise.all([
      prisma.householdIncomeAllocation.findMany({
        where: { budgetYearId: yearIdA },
        include: { incomeEntry: { select: { monthlyEquivalent: true } } },
      }),
      prisma.householdIncomeAllocation.findMany({
        where: { budgetYearId: yearIdB },
        include: { incomeEntry: { select: { monthlyEquivalent: true } } },
      }),
    ])

    const incomeA = allocsA.reduce((s, a) =>
      s + parseFloat(a.incomeEntry.monthlyEquivalent.toString()) * parseFloat(a.allocationPct.toString()) / 100, 0)
    const incomeB = allocsB.reduce((s, a) =>
      s + parseFloat(a.incomeEntry.monthlyEquivalent.toString()) * parseFloat(a.allocationPct.toString()) / 100, 0)

    const expTotalA = expensesA.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
    const expTotalB = expensesB.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
    const savTotalA = savingsA.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
    const savTotalB = savingsB.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
    const surplusA = incomeA - expTotalA - savTotalA
    const surplusB = incomeB - expTotalB - savTotalB

    // ── Expense comparison ─────────────────────────────────────────────────────
    // Match expenses by label (case-insensitive) + categoryId
    type ExpenseRow = {
      status: 'unchanged' | 'changed' | 'new' | 'removed'
      label: string
      category: { id: string; name: string }
      frequency: string
      a: { id: string; amount: string; monthlyEquivalent: string; frequency: string } | null
      b: { id: string; amount: string; monthlyEquivalent: string; frequency: string } | null
      monthlyDelta: string
    }

    const mapA = new Map(expensesA.map((e) => [`${e.label.toLowerCase()}::${e.categoryId}`, e]))
    const mapB = new Map(expensesB.map((e) => [`${e.label.toLowerCase()}::${e.categoryId}`, e]))

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()])
    const rows: ExpenseRow[] = []

    for (const key of allKeys) {
      const ea = mapA.get(key)
      const eb = mapB.get(key)

      const monthlyA = ea ? parseFloat(ea.monthlyEquivalent.toString()) : 0
      const monthlyB = eb ? parseFloat(eb.monthlyEquivalent.toString()) : 0
      const delta = monthlyB - monthlyA

      let status: ExpenseRow['status']
      if (ea && eb) {
        status = Math.abs(delta) < 0.005 ? 'unchanged' : 'changed'
      } else if (eb) {
        status = 'new'
      } else {
        status = 'removed'
      }

      const rep = ea ?? eb!
      rows.push({
        status,
        label: rep.label,
        category: rep.category,
        frequency: (eb ?? ea)!.frequency,
        a: ea ? { id: ea.id, amount: ea.amount.toString(), monthlyEquivalent: ea.monthlyEquivalent.toString(), frequency: ea.frequency } : null,
        b: eb ? { id: eb.id, amount: eb.amount.toString(), monthlyEquivalent: eb.monthlyEquivalent.toString(), frequency: eb.frequency } : null,
        monthlyDelta: delta.toFixed(2),
      })
    }

    // Sort: category name asc, then label asc
    rows.sort((x, y) => {
      const catCmp = x.category.name.localeCompare(y.category.name)
      return catCmp !== 0 ? catCmp : x.label.localeCompare(y.label)
    })

    return reply.send({
      yearA: { id: yearA.id, year: yearA.year, status: yearA.status, simulationName: yearA.simulationName },
      yearB: { id: yearB.id, year: yearB.year, status: yearB.status, simulationName: yearB.simulationName },
      summary: {
        income:   { a: incomeA.toFixed(2),   b: incomeB.toFixed(2),   delta: (incomeB - incomeA).toFixed(2) },
        expenses: { a: expTotalA.toFixed(2),  b: expTotalB.toFixed(2), delta: (expTotalB - expTotalA).toFixed(2) },
        savings:  { a: savTotalA.toFixed(2),  b: savTotalB.toFixed(2), delta: (savTotalB - savTotalA).toFixed(2) },
        surplus:  { a: surplusA.toFixed(2),   b: surplusB.toFixed(2),  delta: (surplusB - surplusA).toFixed(2) },
      },
      expenses: rows,
    })
  })
}
