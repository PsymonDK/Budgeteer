import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { getJobMonthlyIncome } from '../lib/incomeCalc'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatYYYYMM(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function profileRoutes(fastify: FastifyInstance) {

  // ── GET /users/me/income/summary ─────────────────────────────────────────────
  fastify.get('/users/me/income/summary', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const today = new Date()

    // Fetch active jobs for current user
    const jobs = await prisma.job.findMany({
      where: { userId, endDate: null },
    })

    // Compute monthly income for each job
    const jobIncomes = await Promise.all(
      jobs.map(async (job) => {
        const { gross } = await getJobMonthlyIncome(job.id, today)
        return { job, monthly: gross }
      })
    )

    const totalMonthly = jobIncomes.reduce((s, { monthly }) => s + monthly, 0)
    const jobIds = jobs.map((j) => j.id)

    // Fetch allocations for active jobs, only for ACTIVE/FUTURE budget years
    const allocations = await prisma.householdIncomeAllocation.findMany({
      where: {
        jobId: { in: jobIds },
        budgetYear: { status: { in: ['ACTIVE', 'FUTURE'] } },
      },
    })

    // Build a map of jobId -> gross monthly income
    const jobIncomeMap = new Map(jobIncomes.map(({ job, monthly }) => [job.id, monthly]))

    let totalAllocated = 0
    for (const alloc of allocations) {
      const monthly = jobIncomeMap.get(alloc.jobId) ?? 0
      totalAllocated += monthly * parseFloat(alloc.allocationPct.toString()) / 100
    }

    const totalUnallocated = totalMonthly - totalAllocated
    const allocationPct = totalMonthly > 0 ? (totalAllocated / totalMonthly) * 100 : 0
    const overAllocated = allocationPct > 100

    return reply.send({
      totalMonthly: totalMonthly.toFixed(2),
      totalAllocated: totalAllocated.toFixed(2),
      totalUnallocated: totalUnallocated.toFixed(2),
      allocationPct: allocationPct.toFixed(2),
      overAllocated,
    })
  })

  // ── GET /users/me/income/trend ───────────────────────────────────────────────
  fastify.get('/users/me/income/trend', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const today = new Date()

    // Build 12-month window: from (today - 11 months) to today
    const start = firstDayOfMonth(addMonths(today, -11))
    const months: string[] = []
    for (let i = 0; i < 12; i++) {
      months.push(formatYYYYMM(addMonths(start, i)))
    }

    // Fetch all user jobs with salary records and overrides (including ended jobs)
    const jobs = await prisma.job.findMany({
      where: { userId },
      include: {
        salaryRecords: { orderBy: { effectiveFrom: 'asc' } },
        overrides: true,
        bonuses: true,
      },
    })

    // Compute monthly income per job per month
    const jobTrends = jobs.map((job) => {
      const monthly: number[] = months.map((monthStr) => {
        const [year, mon] = monthStr.split('-').map(Number)
        const refDate = new Date(year, mon - 1, 1)

        // If job hadn't started yet, return 0
        if (job.startDate > new Date(year, mon - 1, 28)) return 0
        // If job ended before this month, return 0
        if (job.endDate && job.endDate < refDate) return 0

        // Check override first
        const override = job.overrides.find((o) => o.year === year && o.month === mon)
        if (override) return parseFloat(override.grossAmount.toString())

        // Fall back to latest salary record effective on or before refDate
        const salary = [...job.salaryRecords]
          .filter((s) => s.effectiveFrom <= refDate)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]

        return salary ? parseFloat(salary.grossAmount.toString()) : 0
      })

      return { id: job.id, name: job.name, monthly }
    })

    // Compute totals per month
    const total: number[] = months.map((_, i) =>
      jobTrends.reduce((s, j) => s + j.monthly[i], 0)
    )

    // Collect bonuses within the 12-month window
    const windowStart = new Date(`${months[0]}-01`)
    const windowEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    const bonuses: { jobId: string; month: string; amount: number; label: string }[] = []
    for (const job of jobs) {
      for (const bonus of job.bonuses) {
        const pd = bonus.paymentDate
        if (pd >= windowStart && pd <= windowEnd) {
          bonuses.push({
            jobId: job.id,
            month: formatYYYYMM(pd),
            amount: parseFloat(bonus.grossAmount.toString()),
            label: bonus.label,
          })
        }
      }
    }

    return reply.send({ months, jobs: jobTrends, total, bonuses })
  })

  // ── GET /users/me/income/sankey ──────────────────────────────────────────────
  fastify.get('/users/me/income/sankey', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const today = new Date()

    // Fetch active jobs
    const activeJobs = await prisma.job.findMany({
      where: { userId, endDate: null },
    })

    const jobIncomes = await Promise.all(
      activeJobs.map(async (job) => {
        const { gross } = await getJobMonthlyIncome(job.id, today)
        return { job, gross }
      })
    )

    const totalIncome = jobIncomes.reduce((s, { gross }) => s + gross, 0)
    const jobIds = activeJobs.map((j) => j.id)
    const jobIncomeMap = new Map(jobIncomes.map(({ job, gross }) => [job.id, gross]))

    // Fetch all allocations for active jobs with ACTIVE/FUTURE budget years, including household name
    const allocations = await prisma.householdIncomeAllocation.findMany({
      where: {
        jobId: { in: jobIds },
        budgetYear: { status: { in: ['ACTIVE', 'FUTURE'] } },
      },
      include: {
        budgetYear: {
          include: {
            household: { select: { id: true, name: true } },
          },
        },
      },
    })

    // Group allocations by household
    const householdMap = new Map<
      string,
      { householdId: string; householdName: string; allocatedAmount: number; budgetYearId: string }
    >()

    for (const alloc of allocations) {
      const monthly = jobIncomeMap.get(alloc.jobId) ?? 0
      const allocated = monthly * parseFloat(alloc.allocationPct.toString()) / 100
      const hhId = alloc.budgetYear.household.id
      const hhName = alloc.budgetYear.household.name
      const existing = householdMap.get(hhId)
      if (existing) {
        existing.allocatedAmount += allocated
      } else {
        householdMap.set(hhId, {
          householdId: hhId,
          householdName: hhName,
          allocatedAmount: allocated,
          budgetYearId: alloc.budgetYearId,
        })
      }
    }

    const totalAllocated = [...householdMap.values()].reduce((s, h) => s + h.allocatedAmount, 0)
    const unallocatedAmount = totalIncome - totalAllocated

    // For each household, fetch expenses and savings totals scaled to user's share
    const householdDetails = await Promise.all(
      [...householdMap.values()].map(async (hh) => {
        const [expenseRows, savingsRows, allAllocations] = await Promise.all([
          prisma.expense.findMany({ where: { budgetYearId: hh.budgetYearId } }),
          prisma.savingsEntry.findMany({ where: { budgetYearId: hh.budgetYearId } }),
          prisma.householdIncomeAllocation.findMany({ where: { budgetYearId: hh.budgetYearId } }),
        ])

        const totalExpenses = expenseRows.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)
        const totalSavings = savingsRows.reduce((s, e) => s + parseFloat(e.monthlyEquivalent.toString()), 0)

        // Compute total household gross income to determine user's proportional share
        const allAllocGross = await Promise.all(
          allAllocations.map(async (alloc) => {
            const { gross } = await getJobMonthlyIncome(alloc.jobId, today)
            return gross * parseFloat(alloc.allocationPct.toString()) / 100
          })
        )
        const totalHouseholdGross = allAllocGross.reduce((s, v) => s + v, 0)
        const userSharePct = totalHouseholdGross > 0 ? hh.allocatedAmount / totalHouseholdGross : 0

        const expenses = totalExpenses * userSharePct
        const savings = totalSavings * userSharePct
        const surplus = Math.max(0, hh.allocatedAmount - expenses - savings)

        return {
          ...hh,
          expenses,
          savings,
          surplus,
        }
      })
    )

    // Build d3-sankey nodes and links
    // Node IDs: job_<jobId>, household_<hhId>, expenses_<hhId>, savings_<hhId>, surplus_<hhId>, unallocated
    const JOB_COLOR_PALETTE = [
      '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
      '#ec4899', '#06b6d4', '#84cc16',
    ]

    const nodes: { id: string; name: string; color?: string }[] = []
    const links: { source: string; target: string; value: number }[] = []

    // Job nodes
    jobIncomes.forEach(({ job, gross }, i) => {
      if (gross <= 0) return
      nodes.push({ id: `job_${job.id}`, name: job.name, color: JOB_COLOR_PALETTE[i % JOB_COLOR_PALETTE.length] })
    })

    // Household nodes + links from jobs
    for (const hh of householdDetails) {
      if (hh.allocatedAmount <= 0) continue
      nodes.push({ id: `household_${hh.householdId}`, name: hh.householdName })

      // Link from each contributing job to household
      for (const alloc of allocations.filter((a) => a.budgetYear.household.id === hh.householdId)) {
        const monthly = jobIncomeMap.get(alloc.jobId) ?? 0
        const allocated = monthly * parseFloat(alloc.allocationPct.toString()) / 100
        if (allocated > 0) {
          links.push({
            source: `job_${alloc.jobId}`,
            target: `household_${hh.householdId}`,
            value: allocated,
          })
        }
      }

      // Expense node
      if (hh.expenses > 0) {
        nodes.push({ id: `expenses_${hh.householdId}`, name: `${hh.householdName} — Expenses` })
        links.push({ source: `household_${hh.householdId}`, target: `expenses_${hh.householdId}`, value: hh.expenses })
      }

      // Savings node
      if (hh.savings > 0) {
        nodes.push({ id: `savings_${hh.householdId}`, name: `${hh.householdName} — Savings` })
        links.push({ source: `household_${hh.householdId}`, target: `savings_${hh.householdId}`, value: hh.savings })
      }

      // Surplus node
      if (hh.surplus > 0) {
        nodes.push({ id: `surplus_${hh.householdId}`, name: `${hh.householdName} — Surplus` })
        links.push({ source: `household_${hh.householdId}`, target: `surplus_${hh.householdId}`, value: hh.surplus })
      }
    }

    // Unallocated node
    if (unallocatedAmount > 0) {
      nodes.push({ id: 'unallocated', name: 'Unallocated' })
      for (const { job, gross } of jobIncomes) {
        if (gross <= 0) continue
        // Proportion of unallocated from this job
        const jobAllocated = allocations
          .filter((a) => a.jobId === job.id)
          .reduce((s, a) => s + gross * parseFloat(a.allocationPct.toString()) / 100, 0)
        const jobUnallocated = gross - jobAllocated
        if (jobUnallocated > 0) {
          links.push({ source: `job_${job.id}`, target: 'unallocated', value: jobUnallocated })
        }
      }
    }

    return reply.send({
      totalIncome: totalIncome.toFixed(2),
      nodes,
      links,
    })
  })
}
