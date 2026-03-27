import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { getJobMonthlyIncome } from '../lib/incomeCalc'
import { toNum } from '../lib/decimal'

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
      totalAllocated += monthly * toNum(alloc.allocationPct) / 100
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

    // Collect bonuses within the 12-month window
    const windowStart = new Date(`${months[0]}-01`)
    const windowEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    const bonuses: { jobId: string; month: string; amount: number; label: string }[] = []
    // bonus amount map: "<jobId>::<YYYY-MM>" -> total bonus gross for that month
    const bonusAmountMap = new Map<string, number>()
    for (const job of jobs) {
      for (const bonus of job.bonuses) {
        const pd = bonus.paymentDate
        if (pd >= windowStart && pd <= windowEnd) {
          const monthStr = formatYYYYMM(pd)
          bonuses.push({ jobId: job.id, month: monthStr, amount: toNum(bonus.grossAmount), label: bonus.label })
          const key = `${job.id}::${monthStr}`
          bonusAmountMap.set(key, (bonusAmountMap.get(key) ?? 0) + toNum(bonus.grossAmount))
        }
      }
    }

    // Compute monthly income per job per month (salary + any bonuses received that month)
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
        const salary = override
          ? toNum(override.grossAmount)
          : (() => {
              const rec = [...job.salaryRecords]
                .filter((s) => s.effectiveFrom <= refDate)
                .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
              return rec ? toNum(rec.grossAmount) : 0
            })()

        return salary + (bonusAmountMap.get(`${job.id}::${monthStr}`) ?? 0)
      })

      return { id: job.id, name: job.name, monthly }
    })

    // Compute totals per month
    const total: number[] = months.map((_, i) =>
      jobTrends.reduce((s, j) => s + j.monthly[i], 0)
    )

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
        const { gross, net } = await getJobMonthlyIncome(job.id, today)
        return { job, gross, net }
      })
    )

    const totalIncome = jobIncomes.reduce((s, { gross }) => s + gross, 0)
    const jobIds = activeJobs.map((j) => j.id)
    const jobIncomeMap = new Map(jobIncomes.map(({ job, gross }) => [job.id, gross]))
    const jobNetIncomeMap = new Map(jobIncomes.map(({ job, net }) => [job.id, net]))

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
      { householdId: string; householdName: string; allocatedAmount: number; allocatedNet: number; budgetYearId: string }
    >()

    for (const alloc of allocations) {
      const pct = toNum(alloc.allocationPct) / 100
      const monthly = jobIncomeMap.get(alloc.jobId) ?? 0
      const monthlyNet = jobNetIncomeMap.get(alloc.jobId) ?? 0
      const allocated = monthly * pct
      const allocatedNet = monthlyNet * pct
      const hhId = alloc.budgetYear.household.id
      const hhName = alloc.budgetYear.household.name
      const existing = householdMap.get(hhId)
      if (existing) {
        existing.allocatedAmount += allocated
        existing.allocatedNet += allocatedNet
      } else {
        householdMap.set(hhId, {
          householdId: hhId,
          householdName: hhName,
          allocatedAmount: allocated,
          allocatedNet: allocatedNet,
          budgetYearId: alloc.budgetYearId,
        })
      }
    }

    const totalAllocated = [...householdMap.values()].reduce((s, h) => s + h.allocatedAmount, 0)
    const unallocatedAmount = totalIncome - totalAllocated

    // For each household, compute user's share of expenses/savings/taxes/surplus
    const householdDetails = await Promise.all(
      [...householdMap.values()].map(async (hh) => {
        const [expenseRows, savingsRows, allAllocations] = await Promise.all([
          prisma.expense.findMany({ where: { budgetYearId: hh.budgetYearId } }),
          prisma.savingsEntry.findMany({ where: { budgetYearId: hh.budgetYearId } }),
          prisma.householdIncomeAllocation.findMany({ where: { budgetYearId: hh.budgetYearId } }),
        ])

        const totalExpenses = expenseRows.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
        const totalSavings = savingsRows.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

        // Compute total household gross income to determine user's proportional share
        const allAllocGross = await Promise.all(
          allAllocations.map(async (alloc) => {
            const { gross } = await getJobMonthlyIncome(alloc.jobId, today)
            return gross * toNum(alloc.allocationPct) / 100
          })
        )
        const totalHouseholdGross = allAllocGross.reduce((s, v) => s + v, 0)
        const userSharePct = totalHouseholdGross > 0 ? hh.allocatedAmount / totalHouseholdGross : 0

        const expenses = totalExpenses * userSharePct
        const savings = totalSavings * userSharePct
        const taxes = hh.allocatedAmount - hh.allocatedNet
        const surplus = Math.max(0, hh.allocatedNet - expenses - savings)

        return { ...hh, totalHouseholdGross, taxes, expenses, savings, surplus }
      })
    )

    // Accumulate per-job contributions to each aggregate bucket across all households.
    // For each job's allocation to household H, its fraction of the user's H-bucket is:
    //   frac = (gross_J * pct_Jh) / userAllocGross_H
    const jobBuckets = new Map<string, { taxes: number; expenses: number; savings: number; surplus: number }>()
    for (const { job } of jobIncomes) {
      jobBuckets.set(job.id, { taxes: 0, expenses: 0, savings: 0, surplus: 0 })
    }

    for (const hh of householdDetails) {
      if (hh.allocatedAmount <= 0) continue
      for (const alloc of allocations.filter((a) => a.budgetYear.household.id === hh.householdId)) {
        const gross = jobIncomeMap.get(alloc.jobId) ?? 0
        const allocated = gross * toNum(alloc.allocationPct) / 100
        const frac = hh.allocatedAmount > 0 ? allocated / hh.allocatedAmount : 0
        const bucket = jobBuckets.get(alloc.jobId)
        if (!bucket) continue
        bucket.taxes += hh.taxes * frac
        bucket.expenses += hh.expenses * frac
        bucket.savings += hh.savings * frac
        bucket.surplus += hh.surplus * frac
      }
    }

    // Build d3-sankey nodes and links — 2-column: Jobs → aggregate buckets (no household pass-through)
    const JOB_COLOR_PALETTE = [
      '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
      '#ec4899', '#06b6d4', '#84cc16',
    ]

    const nodes: { id: string; name: string; color?: string }[] = []
    const links: { source: string; target: string; value: number }[] = []

    // Compute aggregate bucket totals to decide which right-side nodes to emit
    const aggTaxes = householdDetails.reduce((s, h) => s + h.taxes, 0)
    const aggExpenses = householdDetails.reduce((s, h) => s + h.expenses, 0)
    const aggSavings = householdDetails.reduce((s, h) => s + h.savings, 0)
    const aggSurplus = householdDetails.reduce((s, h) => s + h.surplus, 0)

    // Job nodes
    jobIncomes.forEach(({ job, gross }, i) => {
      if (gross <= 0) return
      nodes.push({ id: `job_${job.id}`, name: job.name, color: JOB_COLOR_PALETTE[i % JOB_COLOR_PALETTE.length] })
    })

    // Right-side aggregate nodes
    if (aggTaxes > 0) nodes.push({ id: 'taxes', name: 'Taxes' })
    if (aggExpenses > 0) nodes.push({ id: 'expenses', name: 'Expenses' })
    if (aggSavings > 0) nodes.push({ id: 'savings', name: 'Savings' })
    if (aggSurplus > 0) nodes.push({ id: 'surplus', name: 'Surplus' })
    if (unallocatedAmount > 0) nodes.push({ id: 'unallocated', name: 'Unallocated' })

    // Links: job → each right-side bucket
    for (const { job, gross } of jobIncomes) {
      if (gross <= 0) continue
      const bucket = jobBuckets.get(job.id)!
      if (bucket.taxes > 0) links.push({ source: `job_${job.id}`, target: 'taxes', value: bucket.taxes })
      if (bucket.expenses > 0) links.push({ source: `job_${job.id}`, target: 'expenses', value: bucket.expenses })
      if (bucket.savings > 0) links.push({ source: `job_${job.id}`, target: 'savings', value: bucket.savings })
      if (bucket.surplus > 0) links.push({ source: `job_${job.id}`, target: 'surplus', value: bucket.surplus })

      // Unallocated portion of this job
      const jobAllocated = allocations
        .filter((a) => a.jobId === job.id)
        .reduce((s, a) => s + gross * parseFloat(a.allocationPct.toString()) / 100, 0)
      const jobUnallocated = gross - jobAllocated
      if (jobUnallocated > 0) links.push({ source: `job_${job.id}`, target: 'unallocated', value: jobUnallocated })
    }

    return reply.send({
      totalIncome: totalIncome.toFixed(2),
      nodes,
      links,
    })
  })
}
