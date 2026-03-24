import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'

// ── Shared income helper ──────────────────────────────────────────────────────

async function calcIncomeForYear(householdId: string, budgetYearId: string, memberUserIds: string[]) {
  return Promise.all(
    memberUserIds.map(async (userId) => {
      const entries = await prisma.incomeEntry.findMany({
        where: { userId, allocations: { some: { budgetYearId } } },
        include: { allocations: { where: { budgetYearId } } },
      })
      return entries.reduce((sum, e) => {
        const pct = parseFloat((e.allocations[0]?.allocationPct ?? '0').toString())
        return sum + parseFloat(e.monthlyEquivalent.toString()) * pct / 100
      }, 0)
    })
  )
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  // ── GET /households/:id/summary ─────────────────────────────────────────────
  // Optional ?budgetYearId= to view any year (including retired) as read-only
  fastify.get('/households/:id/summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { budgetYearId: requestedYearId } = request.query as { budgetYearId?: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const member = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    // Get household + members
    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    })
    if (!household) return reply.status(404).send({ error: 'Household not found' })

    // Resolve budget year — specific or default active/future
    let activeBudgetYear
    if (requestedYearId) {
      activeBudgetYear = await prisma.budgetYear.findFirst({
        where: { id: requestedYearId, householdId },
      })
      if (!activeBudgetYear) return reply.status(404).send({ error: 'Budget year not found' })
    } else {
      activeBudgetYear = await prisma.budgetYear.findFirst({
        where: { householdId, status: { in: ['ACTIVE', 'FUTURE'] } },
        orderBy: [{ status: 'asc' }, { year: 'asc' }],
      })
    }

    if (!activeBudgetYear) {
      return reply.send({
        budgetYear: null,
        income: { totalMonthly: '0.00', members: [] },
        expenses: { totalMonthly: '0.00', items: [], byCategory: [] },
        savings: { totalMonthly: '0.00' },
        surplus: '0.00',
        memberSplits: [],
        warnings: {
          expensesExceedIncome: false,
          noSavings: false,
          uncategorisedExpenses: false,
          unnamedSimulations: false,
        },
      })
    }

    // ── Income ──────────────────────────────────────────────────────────────
    const incomeAmounts = await calcIncomeForYear(
      householdId,
      activeBudgetYear.id,
      household.members.map((m) => m.userId)
    )
    const totalMonthlyIncome = incomeAmounts.reduce((s, v) => s + v, 0)
    const incomeMembers = household.members.map((m, i) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      monthlyAllocated: incomeAmounts[i].toFixed(2),
      sharePct: totalMonthlyIncome > 0
        ? ((incomeAmounts[i] / totalMonthlyIncome) * 100).toFixed(1)
        : '0.0',
    }))

    // ── Expenses ─────────────────────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: { budgetYearId: activeBudgetYear.id },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
    })
    const totalMonthlyExpenses = expenses.reduce(
      (s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0
    )
    const byCategoryMap = new Map<string, { categoryId: string; categoryName: string; totalMonthly: number }>()
    for (const e of expenses) {
      const existing = byCategoryMap.get(e.categoryId) ?? { categoryId: e.categoryId, categoryName: e.category.name, totalMonthly: 0 }
      existing.totalMonthly += parseFloat(e.monthlyEquivalent.toString())
      byCategoryMap.set(e.categoryId, existing)
    }
    const byCategory = [...byCategoryMap.values()]
      .sort((a, b) => b.totalMonthly - a.totalMonthly)
      .map((c) => ({ ...c, totalMonthly: c.totalMonthly.toFixed(2) }))

    // ── Savings ──────────────────────────────────────────────────────────────
    const savingsEntries = await prisma.savingsEntry.findMany({
      where: { budgetYearId: activeBudgetYear.id },
    })
    const totalMonthlySavings = savingsEntries.reduce(
      (s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0
    )

    // ── Surplus + splits ─────────────────────────────────────────────────────
    const surplus = totalMonthlyIncome - totalMonthlyExpenses - totalMonthlySavings
    const memberSplits = incomeMembers.map((m) => ({
      userId: m.userId,
      name: m.name,
      sharePct: m.sharePct,
      monthlyIncomeAllocated: m.monthlyAllocated,
      monthlyExpensesOwed: (totalMonthlyExpenses * parseFloat(m.sharePct) / 100).toFixed(2),
    }))

    // ── Warnings (only relevant for active/future, not historical views) ──────
    const unnamedSimulations = requestedYearId ? 0 : await prisma.budgetYear.count({
      where: { householdId, status: 'SIMULATION', simulationName: null },
    })
    const warnings = {
      expensesExceedIncome: totalMonthlyExpenses > totalMonthlyIncome && totalMonthlyIncome > 0,
      noSavings: savingsEntries.length === 0,
      uncategorisedExpenses: false,
      unnamedSimulations: unnamedSimulations > 0,
    }

    return reply.send({
      budgetYear: { id: activeBudgetYear.id, year: activeBudgetYear.year, status: activeBudgetYear.status },
      income: { totalMonthly: totalMonthlyIncome.toFixed(2), members: incomeMembers },
      expenses: {
        totalMonthly: totalMonthlyExpenses.toFixed(2),
        items: expenses.map((e) => ({
          id: e.id, label: e.label, amount: e.amount, frequency: e.frequency,
          frequencyPeriod: e.frequencyPeriod, monthlyEquivalent: e.monthlyEquivalent,
          notes: e.notes, category: e.category,
        })),
        byCategory,
      },
      savings: { totalMonthly: totalMonthlySavings.toFixed(2) },
      surplus: surplus.toFixed(2),
      memberSplits,
      warnings,
    })
  })

  // ── GET /households/:id/trends ──────────────────────────────────────────────
  // Year-over-year income / expenses / savings for all non-simulation budget years
  fastify.get('/households/:id/trends', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    if (role !== 'SYSTEM_ADMIN') {
      const member = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
      })
      if (!member) return reply.status(403).send({ error: 'Forbidden' })
    }

    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: { members: true },
    })
    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const years = await prisma.budgetYear.findMany({
      where: { householdId, status: { not: 'SIMULATION' } },
      include: {
        expenses: { include: { category: { select: { id: true, name: true } } } },
        savingsEntries: true,
      },
      orderBy: { year: 'asc' },
    })

    const memberUserIds = household.members.map((m) => m.userId)

    const rows = await Promise.all(
      years.map(async (y) => {
        const incomeAmounts = await calcIncomeForYear(householdId, y.id, memberUserIds)
        const totalIncome = incomeAmounts.reduce((s, v) => s + v, 0)
        const totalExpenses = y.expenses.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
        const totalSavings = y.savingsEntries.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)

        // Category breakdown for this year
        const catMap = new Map<string, { categoryId: string; categoryName: string; totalMonthly: number }>()
        for (const e of y.expenses) {
          const cur = catMap.get(e.categoryId) ?? { categoryId: e.categoryId, categoryName: e.category.name, totalMonthly: 0 }
          cur.totalMonthly += parseFloat(e.monthlyEquivalent.toString())
          catMap.set(e.categoryId, cur)
        }

        return {
          budgetYearId: y.id,
          year: y.year,
          status: y.status,
          totalMonthlyIncome: totalIncome.toFixed(2),
          totalMonthlyExpenses: totalExpenses.toFixed(2),
          totalMonthlySavings: totalSavings.toFixed(2),
          surplus: (totalIncome - totalExpenses - totalSavings).toFixed(2),
          expensesByCategory: [...catMap.values()]
            .sort((a, b) => b.totalMonthly - a.totalMonthly)
            .map((c) => ({ ...c, totalMonthly: c.totalMonthly.toFixed(2) })),
        }
      })
    )

    return reply.send(rows)
  })
}
