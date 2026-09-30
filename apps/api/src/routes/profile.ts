import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { Decimal } from '@prisma/client/runtime/client'
import { getIncomeReferenceDate, JOB_INCOME_INCLUDE } from '../lib/incomeCalc'
import { toNum } from '../lib/decimal'
import {
  loadUserBudgetShare,
  loadUserBudgetSharesByHousehold,
  totalExpensesOf,
  totalSavingsOf,
} from '../lib/userBudgetShare'
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

    // Jobs employed this month (a job with a future endDate still counts), with
    // the budget-basis income the dashboard cards use
    const { jobs, incomes: budgetIncomes } = await loadAllocationOverview(userId, today)
    const activeJobs = jobs.filter((job) => isJobActiveInMonth(job, year, month))

    // This month's salary (or override) per job in base currency, plus the
    // record it came from for its payslip deduction lines, plus the yearly
    // average of budget-included bonuses — the same income as the dashboard
    // cards. The payslip lines cover the salary only, so a bonus's tax
    // (gross − net) is shown as A-skat.
    const jobIncomes = activeJobs.map((job) => {
      const income = monthlyIncomeForJob(job, year, month, 'none')
      const bonus = budgetIncomes.get(job.id)
      const bonusGross = bonus?.bonusGross.toNumber() ?? 0
      const bonusNet = bonus?.bonusNet.toNumber() ?? 0
      const bonusTaxes = Math.max(0, bonusGross - bonusNet)
      const gross = income.gross.toNumber() + bonusGross
      const net = income.net.toNumber() + bonusNet

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

      return { job, gross, net, bonusTaxes, deductions, pensionEmployer }
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

    // The user's share of each household's expenses and savings — the same
    // figures as the dashboard cards (see loadUserBudgetSharesByHousehold), so
    // the diagram and the cards agree.
    const { shares: householdShares } = await loadUserBudgetSharesByHousehold(userId)

    // Allocated income per job and the budget it pays for. A household's
    // expenses and savings are spread over the jobs allocated to it by allocated
    // gross; a household none of the user's income is allocated to (e.g. only a
    // personal item there) is spread over all jobs by gross.
    const jobFlows = new Map(
      jobIncomes.map(({ job }) => [job.id, { allocatedGross: 0, allocatedNet: 0, expenses: 0, savings: 0 }])
    )
    for (const alloc of allocations) {
      const flow = jobFlows.get(alloc.jobId)
      if (!flow) continue
      const pct = toNum(alloc.allocationPct) / 100
      flow.allocatedGross += (jobIncomeMap.get(alloc.jobId) ?? 0) * pct
      flow.allocatedNet += (jobNetIncomeMap.get(alloc.jobId) ?? 0) * pct
    }
    for (const { householdId, share } of householdShares) {
      let weights = new Map<string, number>()
      for (const alloc of allocations) {
        if (alloc.budgetYear.household.id !== householdId) continue
        const allocated = (jobIncomeMap.get(alloc.jobId) ?? 0) * toNum(alloc.allocationPct) / 100
        weights.set(alloc.jobId, (weights.get(alloc.jobId) ?? 0) + allocated)
      }
      if (![...weights.values()].some((w) => w > 0)) {
        weights = new Map(jobIncomes.map(({ job, gross }) => [job.id, gross]))
      }
      const weightSum = [...weights.values()].reduce((s, w) => s + w, 0)
      if (weightSum <= 0) continue
      for (const [jobId, weight] of weights) {
        const flow = jobFlows.get(jobId)
        if (!flow) continue
        flow.expenses += totalExpensesOf(share) * weight / weightSum
        flow.savings += totalSavingsOf(share) * weight / weightSum
      }
    }

    const flows = [...jobFlows.values()]
    const totalAllocated = flows.reduce((s, f) => s + f.allocatedGross, 0)
    const totalAllocatedNet = flows.reduce((s, f) => s + f.allocatedNet, 0)
    const unallocatedAmount = totalIncome - totalAllocated
    const aggExpenses = flows.reduce((s, f) => s + f.expenses, 0)
    const aggSavings = flows.reduce((s, f) => s + f.savings, 0)
    // A flow can't be negative: when expenses and savings exceed allocated net
    // income there is simply no surplus node.
    const aggSurplus = Math.max(0, totalAllocatedNet - aggExpenses - aggSavings)

    const JOB_COLOR_PALETTE = [
      '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
      '#ec4899', '#06b6d4', '#84cc16',
    ]

    const nodes: { id: string; name: string; color?: string }[] = []
    const links: { source: string; target: string; value: number }[] = []

    // Job nodes (shared between both layout modes)
    jobIncomes.forEach(({ job, gross }, i) => {
      if (gross <= 0) return
      nodes.push({ id: `job_${job.id}`, name: job.name, color: JOB_COLOR_PALETTE[i % JOB_COLOR_PALETTE.length] })
    })

    // ── 3-column layout: Jobs → Deduction nodes + Net Pay → Expenses/Savings/Surplus ──
    if (useGranularLayout) {
      // Aggregate deduction totals across all jobs. A job without deduction
      // data sends its whole gross − net to A-skat, one with deduction data
      // the tax on its bonuses.
      const taxesToASkat = ({ gross, net, bonusTaxes, deductions }: (typeof jobIncomes)[number]) =>
        deductions ? bonusTaxes : Math.max(0, gross - net)
      const aggAmBidrag = jobIncomes.reduce((s, { deductions }) => s + (deductions?.amBidrag ?? 0), 0)
      const aggASkat = jobIncomes.reduce((s, j) => s + (j.deductions?.aSkat ?? 0) + taxesToASkat(j), 0)
      const aggPensionEmployee = jobIncomes.reduce((s, { deductions }) => s + (deductions?.pensionEmployee ?? 0), 0)
      const aggAtp = jobIncomes.reduce((s, { deductions }) => s + (deductions?.atp ?? 0), 0)
      const aggBrutto = jobIncomes.reduce((s, { deductions }) => s + (deductions?.bruttoDeduction ?? 0), 0)
      const aggOther = jobIncomes.reduce((s, { deductions }) => s + (deductions?.otherDeductions ?? 0), 0)
      const totalNetPay = jobIncomes.reduce((s, { net }) => s + net, 0)
      const unallocatedNet = totalNetPay - totalAllocatedNet

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
      if (unallocatedNet > 0) nodes.push({ id: 'unallocated', name: 'Unallocated' })

      // Links: job → deduction nodes + net_pay
      for (const jobIncome of jobIncomes) {
        const { job, gross, net, deductions } = jobIncome
        if (gross <= 0) continue
        const jobId = `job_${job.id}`

        const aSkat = (deductions?.aSkat ?? 0) + taxesToASkat(jobIncome)
        if (aSkat > 0) links.push({ source: jobId, target: 'a_skat', value: aSkat })
        if (deductions) {
          if (deductions.bruttoDeduction > 0) links.push({ source: jobId, target: 'brutto_benefits', value: deductions.bruttoDeduction })
          if (deductions.amBidrag > 0) links.push({ source: jobId, target: 'am_bidrag', value: deductions.amBidrag })
          if (deductions.pensionEmployee > 0) links.push({ source: jobId, target: 'pension_employee', value: deductions.pensionEmployee })
          if (deductions.atp > 0) links.push({ source: jobId, target: 'atp', value: deductions.atp })
          if (deductions.otherDeductions > 0) links.push({ source: jobId, target: 'other_deductions', value: deductions.otherDeductions })
        }
        if (net > 0) links.push({ source: jobId, target: 'net_pay', value: net })
      }

      // Links: net_pay → right-side nodes
      if (totalNetPay > 0) {
        if (aggExpenses > 0) links.push({ source: 'net_pay', target: 'expenses', value: aggExpenses })
        if (aggSavings > 0) links.push({ source: 'net_pay', target: 'savings', value: aggSavings })
        if (aggSurplus > 0) links.push({ source: 'net_pay', target: 'surplus', value: aggSurplus })
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
    const jobSurplus = (f: (typeof flows)[number]) => Math.max(0, f.allocatedNet - f.expenses - f.savings)

    if (flows.some((f) => f.allocatedGross - f.allocatedNet > 0)) nodes.push({ id: 'taxes', name: 'Taxes' })
    if (aggExpenses > 0) nodes.push({ id: 'expenses', name: 'Expenses' })
    if (aggSavings > 0) nodes.push({ id: 'savings', name: 'Savings' })
    if (flows.some((f) => jobSurplus(f) > 0)) nodes.push({ id: 'surplus', name: 'Surplus' })
    if (unallocatedAmount > 0) nodes.push({ id: 'unallocated', name: 'Unallocated' })

    for (const { job, gross } of jobIncomes) {
      if (gross <= 0) continue
      const flow = jobFlows.get(job.id)!
      const jobId = `job_${job.id}`
      const taxes = flow.allocatedGross - flow.allocatedNet
      const surplus = jobSurplus(flow)
      if (taxes > 0) links.push({ source: jobId, target: 'taxes', value: taxes })
      if (flow.expenses > 0) links.push({ source: jobId, target: 'expenses', value: flow.expenses })
      if (flow.savings > 0) links.push({ source: jobId, target: 'savings', value: flow.savings })
      if (surplus > 0) links.push({ source: jobId, target: 'surplus', value: surplus })
      const jobUnallocated = gross - flow.allocatedGross
      if (jobUnallocated > 0) links.push({ source: jobId, target: 'unallocated', value: jobUnallocated })
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

    // ── Expenses & Savings ────────────────────────────────────────────────────
    // The user's share of each household's default budget year — the same
    // figures the income flow diagram uses (see loadUserBudgetSharesByHousehold).
    const { householdIds, shares: householdShares } = await loadUserBudgetSharesByHousehold(userId)

    let personalExpenses = 0
    let householdShareExpenses = 0
    let personalSavings = 0
    let householdShareSavings = 0

    // Expense sparkline: last ≤6 non-simulation budget years across all households
    const expenseYearMap = new Map<number, number>() // year -> user's total expense share
    const savingsYearMap = new Map<number, number>() // year -> user's total savings share

    for (const { budgetYear, share } of householdShares) {
      personalExpenses += share.personalExpenses
      householdShareExpenses += share.householdShareExpenses
      personalSavings += share.personalSavings
      householdShareSavings += share.householdShareSavings

      // Accumulate current budget year into sparkline maps
      const yr = budgetYear.year
      expenseYearMap.set(yr, (expenseYearMap.get(yr) ?? 0) + totalExpensesOf(share))
      savingsYearMap.set(yr, (savingsYearMap.get(yr) ?? 0) + totalSavingsOf(share))
    }

    // Also collect up to 5 prior non-simulation budget years for sparklines
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
        const share = await loadUserBudgetShare(by, userId)
        expenseYearMap.set(by.year, totalExpensesOf(share))
        savingsYearMap.set(by.year, totalSavingsOf(share))
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
