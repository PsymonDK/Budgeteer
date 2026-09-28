import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { Decimal } from '@prisma/client/runtime/client'
import { calcIncomeForYear, getIncomeReferenceDate, JOB_INCOME_INCLUDE } from '../lib/incomeCalc'
import { toNum } from '../lib/decimal'
import { partitionByOwnership } from '../lib/ownership'
import { pickDefaultBudgetYear } from '../lib/budgetYearSelection'
import {
  budgetMonthlyIncomeForJob,
  isJobActiveInMonth,
  monthlyIncomeForJob,
  salaryRecordForMonth,
  yearMonthOfLocalDate,
} from '../lib/jobIncome'
import { findOverAllocations, pickReportingYear, summarizeAllocatedIncome } from '../lib/incomeAllocation'

// ── Helpers ───────────────────────────────────────────────────────────────────

const LIVE_STATUSES = ['ACTIVE', 'FUTURE'] as const

function money(d: Decimal): number {
  return d.toDecimalPlaces(2).toNumber()
}

/**
 * A user's jobs, their monthly income and their household allocations,
 * evaluated per budget year. The summary figures report on one year (the
 * earliest ACTIVE year the user is allocated in, else the earliest FUTURE
 * year, else the current calendar year); over-allocation is checked for
 * every ACTIVE/FUTURE year separately.
 */
async function loadAllocationOverview(userId: string, today: Date) {
  const jobs = await prisma.job.findMany({ where: { userId }, include: JOB_INCOME_INCLUDE })
  const allocations = await prisma.householdIncomeAllocation.findMany({
    where: {
      jobId: { in: jobs.map((j) => j.id) },
      budgetYear: { status: { in: [...LIVE_STATUSES] } },
    },
    include: { budgetYear: { select: { year: true, status: true } } },
  })

  const reportingYear = pickReportingYear(allocations)
  const basis = reportingYear ?? { year: today.getFullYear(), status: 'ACTIVE' as const }
  const ref = yearMonthOfLocalDate(basis.status === 'ACTIVE' ? today : getIncomeReferenceDate(basis.year, basis.status))

  const incomes = new Map(jobs.map((job) => [job.id, budgetMonthlyIncomeForJob(job, basis, ref)]))
  const summary = summarizeAllocatedIncome(
    allocations,
    basis.year,
    new Map([...incomes].map(([jobId, income]) => [jobId, income.gross])),
  )
  const overAllocations = findOverAllocations(allocations)

  return { jobs, incomes, reportingYear, summary, overAllocations }
}

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
    const { jobs, reportingYear, summary, overAllocations } = await loadAllocationOverview(userId, new Date())
    const jobNames = new Map(jobs.map((j) => [j.id, j.name]))

    return reply.send({
      totalMonthly: summary.totalMonthly.toFixed(2),
      totalAllocated: summary.totalAllocated.toFixed(2),
      totalUnallocated: summary.totalUnallocated.toFixed(2),
      allocationPct: summary.allocationPct.toFixed(2),
      // True when any job is allocated more than 100% within one budget year
      overAllocated: overAllocations.length > 0,
      budgetYear: reportingYear ? { year: reportingYear.year, status: reportingYear.status } : null,
      overAllocatedJobs: overAllocations.map((o) => ({
        jobId: o.jobId,
        jobName: jobNames.get(o.jobId) ?? '',
        year: o.year,
        allocationPct: o.totalPct.toFixed(2),
      })),
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

    // All user jobs (including ended ones — they contribute only in their active months)
    const jobs = await prisma.job.findMany({ where: { userId }, include: JOB_INCOME_INCLUDE })

    // Income per job per month in base currency: salary (or override) plus every
    // bonus paid that month at its full amount (a cash view of what was received).
    const bonuses: { jobId: string; month: string; amount: number; amountNet: number; label: string }[] = []
    const jobTrends = jobs.map((job) => {
      const monthly: number[] = []
      const monthlyNet: number[] = []
      for (const monthStr of months) {
        const [year, mon] = monthStr.split('-').map(Number)
        const income = monthlyIncomeForJob(job, year, mon, 'cash')
        monthly.push(money(income.gross))
        monthlyNet.push(money(income.net))
        for (const b of income.bonuses) {
          bonuses.push({ jobId: job.id, month: monthStr, amount: money(b.gross), amountNet: money(b.net), label: b.label })
        }
      }
      return { id: job.id, name: job.name, monthly, monthlyNet }
    })

    // Compute totals per month
    const total: number[] = months.map((_, i) => money(jobTrends.reduce((s, j) => s.plus(j.monthly[i]), new Decimal(0))))
    const totalNet: number[] = months.map((_, i) => money(jobTrends.reduce((s, j) => s.plus(j.monthlyNet[i]), new Decimal(0))))

    return reply.send({ months, jobs: jobTrends, total, totalNet, bonuses })
  })

  // ── GET /users/me/income/sankey ──────────────────────────────────────────────
  fastify.get('/users/me/income/sankey', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() + 1

    // Jobs employed this month (a job with a future endDate still counts)
    const activeJobs = (await prisma.job.findMany({ where: { userId }, include: JOB_INCOME_INCLUDE }))
      .filter((job) => isJobActiveInMonth(job, year, month))

    // This month's salary (or override) per job in base currency, plus the
    // record it came from for its payslip deduction lines. Bonuses are left
    // out: the flow is built from the payslip.
    const jobIncomes = activeJobs.map((job) => {
      const income = monthlyIncomeForJob(job, year, month, 'none')
      const gross = income.gross.toNumber()
      const net = income.net.toNumber()

      const record = income.source === 'override'
        ? job.overrides.find((o) => o.year === year && o.month === month) ?? null
        : income.source === 'salary'
          ? salaryRecordForMonth(job.salaryRecords, year, month)
          : null

      const hasDeductions = record?.deductionsSource != null
      const deductions = hasDeductions && record ? (() => {
        const lines = (record.payslipLines ?? []) as { amount: number; sankeyGroup?: string }[]
        const byGroup = new Map<string, number>()
        for (const line of lines) {
          if (line.sankeyGroup) {
            byGroup.set(line.sankeyGroup, (byGroup.get(line.sankeyGroup) ?? 0) + line.amount)
          }
        }
        return {
          amBidrag: byGroup.get('am_bidrag') ?? 0,
          aSkat: byGroup.get('a_skat') ?? 0,
          pensionEmployee: byGroup.get('pension_employee') ?? 0,
          atp: byGroup.get('atp') ?? 0,
          bruttoDeduction: byGroup.get('brutto_benefits') ?? 0,
          otherDeductions: byGroup.get('other_deductions') ?? 0,
        }
      })() : null
      const pensionEmployer = record?.pensionEmployerMonthly ? toNum(record.pensionEmployerMonthly) : 0

      return { job, gross, net, deductions, pensionEmployer }
    })

    const totalIncome = jobIncomes.reduce((s, { gross }) => s + gross, 0)
    const jobIds = activeJobs.map((j) => j.id)
    const jobIncomeMap = new Map(jobIncomes.map(({ job, gross }) => [job.id, gross]))
    const jobNetIncomeMap = new Map(jobIncomes.map(({ job, net }) => [job.id, net]))

    // Determine layout mode: 3-column if any job has deduction data
    const useGranularLayout = jobIncomes.some(({ deductions }) => deductions !== null)

    // Allocations in each household's default budget year only (earliest
    // ACTIVE, else earliest FUTURE). Summing every ACTIVE/FUTURE year would
    // count a job twice once next year's budget exists.
    const liveAllocations = await prisma.householdIncomeAllocation.findMany({
      where: {
        jobId: { in: jobIds },
        budgetYear: { status: { in: [...LIVE_STATUSES] } },
      },
      include: {
        budgetYear: {
          include: {
            household: {
              select: {
                id: true,
                name: true,
                budgetYears: { where: { status: { in: [...LIVE_STATUSES] } }, select: { id: true, year: true, status: true } },
              },
            },
          },
        },
      },
    })
    const allocations = liveAllocations.filter(
      (a) => pickDefaultBudgetYear(a.budgetYear.household.budgetYears)?.id === a.budgetYearId
    )

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
          prisma.householdIncomeAllocation.findMany({
            where: { budgetYearId: hh.budgetYearId },
            include: { job: { include: JOB_INCOME_INCLUDE } },
          }),
        ])

        const totalExpenses = expenseRows.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)
        const totalSavings = savingsRows.reduce((s, e) => s + toNum(e.monthlyEquivalent), 0)

        // Same basis as the user's own jobs above: this month's salary, no bonuses
        const allAllocGross = allAllocations.map((alloc) =>
          monthlyIncomeForJob(alloc.job, year, month, 'none').gross.toNumber() * toNum(alloc.allocationPct) / 100
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

    // Accumulate per-job contributions to each aggregate bucket across all households
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

    const JOB_COLOR_PALETTE = [
      '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
      '#ec4899', '#06b6d4', '#84cc16',
    ]

    const nodes: { id: string; name: string; color?: string }[] = []
    const links: { source: string; target: string; value: number }[] = []

    const aggExpenses = householdDetails.reduce((s, h) => s + h.expenses, 0)
    const aggSavings = householdDetails.reduce((s, h) => s + h.savings, 0)
    const aggSurplus = householdDetails.reduce((s, h) => s + h.surplus, 0)

    // Job nodes (shared between both layout modes)
    jobIncomes.forEach(({ job, gross }, i) => {
      if (gross <= 0) return
      nodes.push({ id: `job_${job.id}`, name: job.name, color: JOB_COLOR_PALETTE[i % JOB_COLOR_PALETTE.length] })
    })

    // ── 3-column layout: Jobs → Deduction nodes + Net Pay → Expenses/Savings/Surplus ──
    if (useGranularLayout) {
      // Aggregate deduction totals across all jobs
      const aggAmBidrag = jobIncomes.reduce((s, { deductions }) => s + (deductions?.amBidrag ?? 0), 0)
      const aggASkat = jobIncomes.reduce((s, { deductions }) => s + (deductions?.aSkat ?? 0), 0)
      const aggPensionEmployee = jobIncomes.reduce((s, { deductions }) => s + (deductions?.pensionEmployee ?? 0), 0)
      const aggAtp = jobIncomes.reduce((s, { deductions }) => s + (deductions?.atp ?? 0), 0)
      const aggBrutto = jobIncomes.reduce((s, { deductions }) => s + (deductions?.bruttoDeduction ?? 0), 0)
      const aggOther = jobIncomes.reduce((s, { deductions }) => s + (deductions?.otherDeductions ?? 0), 0)
      const totalNetPay = jobIncomes.reduce((s, { net }) => s + net, 0)

      // Middle column: deduction nodes
      if (aggBrutto > 0) nodes.push({ id: 'brutto_benefits', name: 'Brutto Benefits' })
      if (aggAmBidrag > 0) nodes.push({ id: 'am_bidrag', name: 'AM-bidrag' })
      if (aggASkat > 0) nodes.push({ id: 'a_skat', name: 'A-skat' })
      if (aggPensionEmployee > 0) nodes.push({ id: 'pension_employee', name: 'Pension (Employee)' })
      if (aggAtp > 0) nodes.push({ id: 'atp', name: 'ATP' })
      if (aggOther > 0) nodes.push({ id: 'other_deductions', name: 'Other Deductions' })
      nodes.push({ id: 'net_pay', name: 'Net Pay' })

      // Right column
      if (aggExpenses > 0) nodes.push({ id: 'expenses', name: 'Expenses' })
      if (aggSavings > 0) nodes.push({ id: 'savings', name: 'Savings' })
      if (aggSurplus > 0) nodes.push({ id: 'surplus', name: 'Surplus' })
      if (unallocatedAmount > 0) nodes.push({ id: 'unallocated', name: 'Unallocated' })

      // Links: job → deduction nodes + net_pay
      for (const { job, gross, net, deductions } of jobIncomes) {
        if (gross <= 0) continue
        const jobId = `job_${job.id}`

        if (deductions) {
          if (deductions.bruttoDeduction > 0) links.push({ source: jobId, target: 'brutto_benefits', value: deductions.bruttoDeduction })
          if (deductions.amBidrag > 0) links.push({ source: jobId, target: 'am_bidrag', value: deductions.amBidrag })
          if (deductions.aSkat > 0) links.push({ source: jobId, target: 'a_skat', value: deductions.aSkat })
          if (deductions.pensionEmployee > 0) links.push({ source: jobId, target: 'pension_employee', value: deductions.pensionEmployee })
          if (deductions.atp > 0) links.push({ source: jobId, target: 'atp', value: deductions.atp })
          if (deductions.otherDeductions > 0) links.push({ source: jobId, target: 'other_deductions', value: deductions.otherDeductions })
        } else {
          // Job without deduction data — its taxes component flows to a_skat as fallback
          const bucket = jobBuckets.get(job.id)!
          if (bucket.taxes > 0) links.push({ source: jobId, target: 'a_skat', value: bucket.taxes })
        }
        if (net > 0) links.push({ source: jobId, target: 'net_pay', value: net })
      }

      // Links: net_pay → right-side nodes
      // Proportions from household budget, applied to total net pay
      if (totalNetPay > 0) {
        if (aggExpenses > 0) links.push({ source: 'net_pay', target: 'expenses', value: aggExpenses })
        if (aggSavings > 0) links.push({ source: 'net_pay', target: 'savings', value: aggSavings })
        if (aggSurplus > 0) links.push({ source: 'net_pay', target: 'surplus', value: aggSurplus })
        // Unallocated: scale the gross unallocated proportionally to net
        const unallocatedNet = unallocatedAmount * (totalNetPay / totalIncome)
        if (unallocatedNet > 0) links.push({ source: 'net_pay', target: 'unallocated', value: unallocatedNet })
      }

      const totalEmployerPension = jobIncomes.reduce((s, { pensionEmployer }) => s + pensionEmployer, 0)

      return reply.send({
        totalIncome: totalIncome.toFixed(2),
        ...(totalEmployerPension > 0 && { employerPensionMonthly: totalEmployerPension.toFixed(2) }),
        nodes,
        links,
      })
    }

    // ── 2-column layout (fallback): Jobs → Taxes + Expenses + Savings + Surplus ──
    const aggTaxes = householdDetails.reduce((s, h) => s + h.taxes, 0)

    if (aggTaxes > 0) nodes.push({ id: 'taxes', name: 'Taxes' })
    if (aggExpenses > 0) nodes.push({ id: 'expenses', name: 'Expenses' })
    if (aggSavings > 0) nodes.push({ id: 'savings', name: 'Savings' })
    if (aggSurplus > 0) nodes.push({ id: 'surplus', name: 'Surplus' })
    if (unallocatedAmount > 0) nodes.push({ id: 'unallocated', name: 'Unallocated' })

    for (const { job, gross } of jobIncomes) {
      if (gross <= 0) continue
      const bucket = jobBuckets.get(job.id)!
      if (bucket.taxes > 0) links.push({ source: `job_${job.id}`, target: 'taxes', value: bucket.taxes })
      if (bucket.expenses > 0) links.push({ source: `job_${job.id}`, target: 'expenses', value: bucket.expenses })
      if (bucket.savings > 0) links.push({ source: `job_${job.id}`, target: 'savings', value: bucket.savings })
      if (bucket.surplus > 0) links.push({ source: `job_${job.id}`, target: 'surplus', value: bucket.surplus })

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

  // ── GET /users/me/dashboard ──────────────────────────────────────────────────
  fastify.get('/users/me/dashboard', { preHandler: authenticate }, async (request, reply) => {
    const { sub: userId } = request.user
    const today = new Date()

    // ── Income ────────────────────────────────────────────────────────────────
    // Budget-basis monthly income (salary + yearly-average bonuses) and the
    // allocated share for one budget year — see loadAllocationOverview.
    const { jobs: allJobs, incomes, summary } = await loadAllocationOverview(userId, today)
    const grossMonthly = money([...incomes.values()].reduce((s, i) => s.plus(i.gross), new Decimal(0)))
    const netMonthly = money([...incomes.values()].reduce((s, i) => s.plus(i.net), new Decimal(0)))
    const allocatedAmount = money(summary.totalAllocated)
    const unallocatedAmount = money(summary.totalUnallocated)
    const allocatedPct = summary.allocationPct.toNumber()

    // Income sparkline: last 6 months, in base currency, bonuses by budget mode
    const incomeSparklineStart = firstDayOfMonth(addMonths(today, -5))
    const incomeSparklineMonths: string[] = []
    for (let i = 0; i < 6; i++) incomeSparklineMonths.push(formatYYYYMM(addMonths(incomeSparklineStart, i)))

    const incomeSparkline = incomeSparklineMonths.map((monthStr) => {
      const [year, mon] = monthStr.split('-').map(Number)
      let gross = new Decimal(0)
      let net = new Decimal(0)
      for (const job of allJobs) {
        const income = monthlyIncomeForJob(job, year, mon, 'budget')
        gross = gross.plus(income.gross)
        net = net.plus(income.net)
      }
      return { month: monthStr, gross: money(gross), net: money(net) }
    })

    // ── Households the user belongs to (active/future budget years) ──────────
    const memberships = await prisma.householdMember.findMany({
      where: { userId },
      include: {
        household: {
          include: {
            budgetYears: {
              where: { status: { in: ['ACTIVE', 'FUTURE'] } },
              orderBy: { year: 'asc' },
            },
          },
        },
      },
    })

    // ── Expenses & Savings ────────────────────────────────────────────────────
    let personalExpenses = 0
    let householdShareExpenses = 0
    let personalSavings = 0
    let householdShareSavings = 0

    // Expense sparkline: last ≤6 non-simulation budget years across all households
    const expenseYearMap = new Map<number, number>() // year -> user's total expense share
    const savingsYearMap = new Map<number, number>() // year -> user's total savings share

    for (const membership of memberships) {
      const activeBY = pickDefaultBudgetYear(membership.household.budgetYears)
      if (!activeBY) continue

      const [expenses, savings, incomeResult] = await Promise.all([
        prisma.expense.findMany({
          where: { budgetYearId: activeBY.id },
          include: { customSplits: true },
        }),
        prisma.savingsEntry.findMany({
          where: { budgetYearId: activeBY.id },
          include: { customSplits: true },
        }),
        calcIncomeForYear(activeBY.id, getIncomeReferenceDate(activeBY.year, activeBY.status)),
      ])

      const totalHouseholdGross = incomeResult.totalMonthlyGross
      const userMember = incomeResult.members.find((m) => m.userId === userId)
      const userGross = userMember?.monthlyAllocatedGross ?? 0
      const sharePct = totalHouseholdGross > 0 ? userGross / totalHouseholdGross : 0

      const expPartition = partitionByOwnership(expenses)
      const savPartition = partitionByOwnership(savings)

      personalExpenses += expPartition.individual.get(userId) ?? 0
      householdShareExpenses += expPartition.shared * sharePct + (expPartition.custom.get(userId) ?? 0)
      personalSavings += savPartition.individual.get(userId) ?? 0
      householdShareSavings += savPartition.shared * sharePct + (savPartition.custom.get(userId) ?? 0)

      // Accumulate current budget year into sparkline maps
      const yr = activeBY.year
      expenseYearMap.set(yr, (expenseYearMap.get(yr) ?? 0) +
        (expPartition.individual.get(userId) ?? 0) +
        expPartition.shared * sharePct +
        (expPartition.custom.get(userId) ?? 0))
      savingsYearMap.set(yr, (savingsYearMap.get(yr) ?? 0) +
        (savPartition.individual.get(userId) ?? 0) +
        savPartition.shared * sharePct +
        (savPartition.custom.get(userId) ?? 0))
    }

    // Also collect up to 5 prior non-simulation budget years for sparklines
    const householdIds = memberships.map((m) => m.householdId)
    if (householdIds.length > 0) {
      const historicalYears = await prisma.budgetYear.findMany({
        where: {
          householdId: { in: householdIds },
          status: 'RETIRED',
          simulationName: null,
        },
        orderBy: { year: 'desc' },
        take: 20,
      })

      // Deduplicate by year (take first per year), limit to 5 historical
      const seen = new Set<number>()
      const toCompute: typeof historicalYears = []
      for (const by of historicalYears) {
        if (!seen.has(by.year) && !expenseYearMap.has(by.year)) {
          seen.add(by.year)
          toCompute.push(by)
          if (toCompute.length >= 5) break
        }
      }

      for (const by of toCompute) {
        const [expenses, savings, incomeResult] = await Promise.all([
          prisma.expense.findMany({ where: { budgetYearId: by.id }, include: { customSplits: true } }),
          prisma.savingsEntry.findMany({ where: { budgetYearId: by.id }, include: { customSplits: true } }),
          calcIncomeForYear(by.id, getIncomeReferenceDate(by.year, by.status)),
        ])
        const totalHouseholdGross = incomeResult.totalMonthlyGross
        const userGross = incomeResult.members.find((m) => m.userId === userId)?.monthlyAllocatedGross ?? 0
        const sharePct = totalHouseholdGross > 0 ? userGross / totalHouseholdGross : 0
        const expPartition = partitionByOwnership(expenses)
        const savPartition = partitionByOwnership(savings)
        expenseYearMap.set(by.year,
          (expPartition.individual.get(userId) ?? 0) +
          expPartition.shared * sharePct +
          (expPartition.custom.get(userId) ?? 0))
        savingsYearMap.set(by.year,
          (savPartition.individual.get(userId) ?? 0) +
          savPartition.shared * sharePct +
          (savPartition.custom.get(userId) ?? 0))
      }
    }

    // Build sorted sparkline arrays (oldest → newest, max 6 points)
    const expenseSparkline = [...expenseYearMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-6)
      .map(([year, amount]) => ({ label: String(year), amount }))
    const savingsSparkline = [...savingsYearMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-6)
      .map(([year, amount]) => ({ label: String(year), amount }))

    // ── Surplus ───────────────────────────────────────────────────────────────
    const totalExpenses = personalExpenses + householdShareExpenses
    const totalSavings = personalSavings + householdShareSavings
    const surplusAmount = netMonthly - totalExpenses - totalSavings

    return reply.send({
      income: {
        grossMonthly: grossMonthly.toFixed(2),
        netMonthly: netMonthly.toFixed(2),
        allocatedAmount: allocatedAmount.toFixed(2),
        allocatedPct: allocatedPct.toFixed(2),
        unallocatedAmount: unallocatedAmount.toFixed(2),
        sparkline: incomeSparkline,
      },
      expenses: {
        personal: { monthlyEquivalent: personalExpenses.toFixed(2), sparkline: expenseSparkline },
        householdShare: { monthlyEquivalent: householdShareExpenses.toFixed(2), sparkline: expenseSparkline },
        total: { monthlyEquivalent: (personalExpenses + householdShareExpenses).toFixed(2) },
      },
      savings: {
        monthlyEquivalent: (personalSavings + householdShareSavings).toFixed(2),
        pctOfGross: grossMonthly > 0 ? ((totalSavings / grossMonthly) * 100).toFixed(2) : '0.00',
        pctOfNet: netMonthly > 0 ? ((totalSavings / netMonthly) * 100).toFixed(2) : '0.00',
        sparkline: savingsSparkline,
      },
      surplus: {
        amount: surplusAmount.toFixed(2),
        isPositive: surplusAmount >= 0,
      },
    })
  })
}
