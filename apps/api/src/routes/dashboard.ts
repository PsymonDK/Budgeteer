import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'

export async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /households/:id/summary
  // Single-request dashboard payload: income, expenses, savings, member splits, warnings
  fastify.get('/households/:id/summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { sub: userId, role } = request.user

    // Auth: must be member or system admin
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
        budgetYears: {
          where: { status: { in: ['ACTIVE', 'FUTURE'] } },
          orderBy: [{ status: 'asc' }, { year: 'asc' }],
          take: 1,
        },
      },
    })

    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const activeBudgetYear = household.budgetYears[0] ?? null

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

    // ── Income ────────────────────────────────────────────────────────────────
    const memberIncome = await Promise.all(
      household.members.map(async (m) => {
        const entries = await prisma.incomeEntry.findMany({
          where: {
            userId: m.userId,
            allocations: { some: { budgetYearId: activeBudgetYear.id } },
          },
          include: { allocations: { where: { budgetYearId: activeBudgetYear.id } } },
        })
        const monthlyAllocated = entries.reduce((sum, e) => {
          const pct = parseFloat((e.allocations[0]?.allocationPct ?? '0').toString())
          return sum + parseFloat(e.monthlyEquivalent.toString()) * pct / 100
        }, 0)
        return { userId: m.userId, name: m.user.name, email: m.user.email, monthlyAllocated }
      })
    )

    const totalMonthlyIncome = memberIncome.reduce((s, m) => s + m.monthlyAllocated, 0)

    const incomeMembers = memberIncome.map((m) => ({
      ...m,
      monthlyAllocated: m.monthlyAllocated.toFixed(2),
      sharePct: totalMonthlyIncome > 0
        ? ((m.monthlyAllocated / totalMonthlyIncome) * 100).toFixed(1)
        : '0.0',
    }))

    // ── Expenses ──────────────────────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: { budgetYearId: activeBudgetYear.id },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
    })

    const totalMonthlyExpenses = expenses.reduce(
      (s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0
    )

    // Group by category
    const byCategoryMap = new Map<string, { categoryId: string; categoryName: string; totalMonthly: number }>()
    for (const e of expenses) {
      const existing = byCategoryMap.get(e.categoryId) ?? {
        categoryId: e.categoryId,
        categoryName: e.category.name,
        totalMonthly: 0,
      }
      existing.totalMonthly += parseFloat(e.monthlyEquivalent.toString())
      byCategoryMap.set(e.categoryId, existing)
    }
    const byCategory = [...byCategoryMap.values()]
      .sort((a, b) => b.totalMonthly - a.totalMonthly)
      .map((c) => ({ ...c, totalMonthly: c.totalMonthly.toFixed(2) }))

    // ── Savings ───────────────────────────────────────────────────────────────
    const savingsEntries = await prisma.savingsEntry.findMany({
      where: { budgetYearId: activeBudgetYear.id },
    })
    const totalMonthlySavings = savingsEntries.reduce(
      (s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0
    )

    // ── Surplus ───────────────────────────────────────────────────────────────
    const surplus = totalMonthlyIncome - totalMonthlyExpenses - totalMonthlySavings

    // ── Member expense splits ─────────────────────────────────────────────────
    const memberSplits = incomeMembers.map((m) => ({
      userId: m.userId,
      name: m.name,
      sharePct: m.sharePct,
      monthlyIncomeAllocated: m.monthlyAllocated,
      monthlyExpensesOwed: (totalMonthlyExpenses * parseFloat(m.sharePct) / 100).toFixed(2),
    }))

    // ── Warnings ──────────────────────────────────────────────────────────────
    const unnamedSimulations = await prisma.budgetYear.count({
      where: { householdId, status: 'SIMULATION', simulationName: null },
    })

    const warnings = {
      expensesExceedIncome: totalMonthlyExpenses > totalMonthlyIncome && totalMonthlyIncome > 0,
      noSavings: savingsEntries.length === 0,
      uncategorisedExpenses: false, // requires category on all expenses; enforced by API
      unnamedSimulations: unnamedSimulations > 0,
    }

    return reply.send({
      budgetYear: { id: activeBudgetYear.id, year: activeBudgetYear.year, status: activeBudgetYear.status },
      income: { totalMonthly: totalMonthlyIncome.toFixed(2), members: incomeMembers },
      expenses: {
        totalMonthly: totalMonthlyExpenses.toFixed(2),
        items: expenses.map((e) => ({
          id: e.id,
          label: e.label,
          amount: e.amount,
          frequency: e.frequency,
          frequencyPeriod: e.frequencyPeriod,
          monthlyEquivalent: e.monthlyEquivalent,
          notes: e.notes,
          category: e.category,
        })),
        byCategory,
      },
      savings: { totalMonthly: totalMonthlySavings.toFixed(2) },
      surplus: surplus.toFixed(2),
      memberSplits,
      warnings,
    })
  })
}
