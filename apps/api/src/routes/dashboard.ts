import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { calcIncomeForYear, getIncomeReferenceDate } from '../lib/incomeCalc'
import { assertHouseholdAccess, partitionByOwnership } from '../lib/ownership'
import { toNum } from '../lib/decimal'

export async function dashboardRoutes(fastify: FastifyInstance) {
  // ── GET /me/summary ──────────────────────────────────────────────────────────
  // Aggregated overview across all households the user belongs to
  fastify.get('/me/summary', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user

    const memberships = await prisma.householdMember.findMany({
      where: { userId },
      include: {
        household: {
          include: { _count: { select: { members: true } } },
        },
      },
      orderBy: { joinedAt: 'asc' },
    })

    const householdSummaries = await Promise.all(
      memberships.map(async (m) => {
        const h = m.household

        const activeBY = await prisma.budgetYear.findFirst({
          where: { householdId: h.id, status: { in: ['ACTIVE', 'FUTURE'] } },
          orderBy: [{ status: 'asc' }, { year: 'asc' }],
        })

        if (!activeBY) {
          return {
            id: h.id, name: h.name, myRole: m.role, memberCount: h._count.members,
            monthlyGrossIncome: '0.00', monthlyIncome: '0.00', monthlyExpenses: '0.00', monthlySavings: '0.00', monthlySurplus: '0.00',
            budgetYear: null,
            warnings: { expensesExceedIncome: false, noSavings: false },
            previousYear: null,
          }
        }

        const refDate = getIncomeReferenceDate(activeBY.year, activeBY.status)
        const incomeResult = await calcIncomeForYear(activeBY.id, refDate)
        const myIncome = incomeResult.members.find(m => m.userId === userId)
        const totalGrossIncome = myIncome?.monthlyAllocatedGross ?? 0
        const totalIncome = myIncome?.monthlyAllocatedNet ?? 0

        const [expenses, savingsEntries] = await Promise.all([
          prisma.expense.findMany({ where: { budgetYearId: activeBY.id }, select: { monthlyEquivalent: true } }),
          prisma.savingsEntry.findMany({ where: { budgetYearId: activeBY.id }, select: { monthlyEquivalent: true } }),
        ])
        const totalExpenses = expenses.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
        const totalSavings = savingsEntries.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

        // Previous retired budget year for period comparison
        const previousBY = await prisma.budgetYear.findFirst({
          where: { householdId: h.id, status: 'RETIRED', year: { lt: activeBY.year } },
          orderBy: { year: 'desc' },
        })

        let previousYear = null
        if (previousBY) {
          const prevRef = getIncomeReferenceDate(previousBY.year, previousBY.status)
          const prevIncome = await calcIncomeForYear(previousBY.id, prevRef)
          const myPrevIncome = prevIncome.members.find(m => m.userId === userId)
          const [prevExp, prevSav] = await Promise.all([
            prisma.expense.findMany({ where: { budgetYearId: previousBY.id }, select: { monthlyEquivalent: true } }),
            prisma.savingsEntry.findMany({ where: { budgetYearId: previousBY.id }, select: { monthlyEquivalent: true } }),
          ])
          const prevTotalExpenses = prevExp.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
          const prevTotalSavings = prevSav.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
          previousYear = {
            year: previousBY.year,
            monthlyGrossIncome: (myPrevIncome?.monthlyAllocatedGross ?? 0).toFixed(2),
            monthlyIncome: (myPrevIncome?.monthlyAllocatedNet ?? 0).toFixed(2),
            monthlyExpenses: prevTotalExpenses.toFixed(2),
            monthlySavings: prevTotalSavings.toFixed(2),
            monthlySurplus: ((myPrevIncome?.monthlyAllocatedNet ?? 0) - prevTotalExpenses - prevTotalSavings).toFixed(2),
          }
        }

        return {
          id: h.id, name: h.name, myRole: m.role, memberCount: h._count.members,
          monthlyGrossIncome: totalGrossIncome.toFixed(2),
          monthlyIncome: totalIncome.toFixed(2),
          monthlyExpenses: totalExpenses.toFixed(2),
          monthlySavings: totalSavings.toFixed(2),
          monthlySurplus: (totalIncome - totalExpenses - totalSavings).toFixed(2),
          budgetYear: { id: activeBY.id, year: activeBY.year, status: activeBY.status },
          warnings: {
            expensesExceedIncome: totalExpenses > totalIncome && totalIncome > 0,
            noSavings: savingsEntries.length === 0,
          },
          previousYear,
        }
      })
    )

    // Aggregate totals across all households
    const totalGrossIncome = householdSummaries.reduce((s, h) => s + parseFloat(h.monthlyGrossIncome), 0)
    const totalIncome = householdSummaries.reduce((s, h) => s + parseFloat(h.monthlyIncome), 0)
    const totalExpenses = householdSummaries.reduce((s, h) => s + parseFloat(h.monthlyExpenses), 0)
    const totalSavings = householdSummaries.reduce((s, h) => s + parseFloat(h.monthlySavings), 0)

    const withPrev = householdSummaries.filter((h) => h.previousYear !== null)
    const prevTotalGrossIncome = withPrev.reduce((s, h) => s + parseFloat(h.previousYear!.monthlyGrossIncome), 0)
    const prevTotalIncome = withPrev.reduce((s, h) => s + parseFloat(h.previousYear!.monthlyIncome), 0)
    const prevTotalExpenses = withPrev.reduce((s, h) => s + parseFloat(h.previousYear!.monthlyExpenses), 0)
    const prevTotalSavings = withPrev.reduce((s, h) => s + parseFloat(h.previousYear!.monthlySavings), 0)

    return reply.send({
      totals: {
        monthlyGrossIncome: totalGrossIncome.toFixed(2),
        monthlyIncome: totalIncome.toFixed(2),
        monthlyExpenses: totalExpenses.toFixed(2),
        monthlySavings: totalSavings.toFixed(2),
        monthlySurplus: (totalIncome - totalExpenses - totalSavings).toFixed(2),
      },
      previousTotals: withPrev.length > 0 ? {
        monthlyGrossIncome: prevTotalGrossIncome.toFixed(2),
        monthlyIncome: prevTotalIncome.toFixed(2),
        monthlyExpenses: prevTotalExpenses.toFixed(2),
        monthlySavings: prevTotalSavings.toFixed(2),
        monthlySurplus: (prevTotalIncome - prevTotalExpenses - prevTotalSavings).toFixed(2),
      } : null,
      householdCount: householdSummaries.length,
      households: householdSummaries,
    })
  })

  // ── GET /households/:id/summary ─────────────────────────────────────────────
  // Optional ?budgetYearId= to view any year (including retired) as read-only
  fastify.get('/households/:id/summary', { preHandler: authenticate }, async (request, reply) => {
    const { id: householdId } = request.params as { id: string }
    const { budgetYearId: requestedYearId } = request.query as { budgetYearId?: string }
    const { sub: userId, role } = request.user

    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

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
    const referenceDate = getIncomeReferenceDate(activeBudgetYear.year, activeBudgetYear.status)
    const incomeResult = await calcIncomeForYear(activeBudgetYear.id, referenceDate)
    const totalMonthlyGross = incomeResult.totalMonthlyGross
    const totalMonthlyIncome = incomeResult.totalMonthlyNet
    const memberGrossMap = new Map(incomeResult.members.map((m) => [m.userId, m.monthlyAllocatedGross]))
    const memberNetMap = new Map(incomeResult.members.map((m) => [m.userId, m.monthlyAllocatedNet]))
    const incomeMembers = household.members.map((m) => {
      const allocatedGross = memberGrossMap.get(m.userId) ?? 0
      const allocatedNet = memberNetMap.get(m.userId) ?? 0
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        monthlyAllocated: allocatedNet.toFixed(2),
        monthlyAllocatedGross: allocatedGross.toFixed(2),
        monthlyAllocatedNet: allocatedNet.toFixed(2),
        sharePct: totalMonthlyGross > 0
          ? ((allocatedGross / totalMonthlyGross) * 100).toFixed(1)
          : '0.0',
      }
    })

    // ── Expenses ─────────────────────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: { budgetYearId: activeBudgetYear.id },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        ownedBy: { select: { id: true, name: true } },
        customSplits: true,
      },
      orderBy: [{ category: { name: 'asc' } }, { label: 'asc' }],
    })
    const totalMonthlyExpenses = expenses.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

    // Partition expenses by ownership mode
    const { shared: sharedPool, individual: individualOwedMap, custom: customExpensesMap } = partitionByOwnership(expenses)

    const byCategoryMap = new Map<string, { categoryId: string; categoryName: string; categoryIcon: string | null; totalMonthly: number }>()
    for (const e of expenses) {
      const existing = byCategoryMap.get(e.categoryId) ?? { categoryId: e.categoryId, categoryName: e.category.name, categoryIcon: e.category.icon, totalMonthly: 0 }
      existing.totalMonthly += toNum(e.monthlyEquivalent)
      byCategoryMap.set(e.categoryId, existing)
    }
    const byCategory = [...byCategoryMap.values()]
      .sort((a, b) => b.totalMonthly - a.totalMonthly)
      .map((c) => ({ ...c, totalMonthly: c.totalMonthly.toFixed(2) }))

    // ── Savings ──────────────────────────────────────────────────────────────
    const savingsEntries = await prisma.savingsEntry.findMany({
      where: { budgetYearId: activeBudgetYear.id },
      include: { customSplits: true },
    })
    const totalMonthlySavings = savingsEntries.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

    // Partition savings by ownership mode
    const { shared: sharedSavingsPool, individual: individualSavingsMap, custom: customSavingsMap } = partitionByOwnership(savingsEntries)

    // ── Surplus + splits ─────────────────────────────────────────────────────
    const surplus = totalMonthlyIncome - totalMonthlyExpenses - totalMonthlySavings
    const memberSplits = incomeMembers.map((m) => {
      const sharedOwed = sharedPool * parseFloat(m.sharePct) / 100
      const individualOwed = individualOwedMap.get(m.userId) ?? 0
      const customOwed = customExpensesMap.get(m.userId) ?? 0
      const sharedSavingsOwed = sharedSavingsPool * parseFloat(m.sharePct) / 100
      const individualSavingsOwed = individualSavingsMap.get(m.userId) ?? 0
      const customSavingsOwed = customSavingsMap.get(m.userId) ?? 0
      const totalSavingsOwed = sharedSavingsOwed + individualSavingsOwed + customSavingsOwed
      return {
        userId: m.userId,
        name: m.name,
        sharePct: m.sharePct,
        monthlyIncomeAllocated: m.monthlyAllocated,
        monthlySharedOwed: sharedOwed.toFixed(2),
        monthlyIndividualOwed: individualOwed.toFixed(2),
        monthlyCustomOwed: customOwed.toFixed(2),
        monthlyTotalOwed: (sharedOwed + individualOwed + customOwed).toFixed(2),
        monthlySavingsSharedOwed: sharedSavingsOwed.toFixed(2),
        monthlySavingsIndividualOwed: individualSavingsOwed.toFixed(2),
        monthlySavingsCustomOwed: customSavingsOwed.toFixed(2),
        monthlySavingsTotalOwed: totalSavingsOwed.toFixed(2),
      }
    })

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
          ownership: e.ownership, ownedByUserId: e.ownedByUserId, ownedBy: e.ownedBy,
          customSplits: e.customSplits,
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

    if (!await assertHouseholdAccess(householdId, userId, role, reply)) return

    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: { members: true },
    })
    if (!household) return reply.status(404).send({ error: 'Household not found' })

    const years = await prisma.budgetYear.findMany({
      where: { householdId, status: { not: 'SIMULATION' } },
      include: {
        expenses: { include: { category: { select: { id: true, name: true, icon: true } } } },
        savingsEntries: true,
      },
      orderBy: { year: 'asc' },
    })

    const rows = await Promise.all(
      years.map(async (y) => {
        const refDate = getIncomeReferenceDate(y.year, y.status)
        const incomeResult = await calcIncomeForYear(y.id, refDate)
        const totalIncome = incomeResult.totalMonthlyNet
        const totalExpenses = y.expenses.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
        const totalSavings = y.savingsEntries.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

        // Category breakdown for this year
        const catMap = new Map<string, { categoryId: string; categoryName: string; categoryIcon: string | null; totalMonthly: number }>()
        for (const e of y.expenses) {
          const cur = catMap.get(e.categoryId) ?? { categoryId: e.categoryId, categoryName: e.category.name, categoryIcon: e.category.icon, totalMonthly: 0 }
          cur.totalMonthly += toNum(e.monthlyEquivalent)
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
