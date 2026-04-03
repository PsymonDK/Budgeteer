import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { CategoryIcon } from '../components/CategoryIcon'
import { PageLoader } from '../components/LoadingSpinner'
import { SankeyChart, type SankeyNodeDef, type SankeyLinkDef } from '../components/SankeyChart'
import { FREQ_LABELS } from '../lib/constants'
import { useFmt, useBaseCurrency } from '../hooks/useFmt'
import { useTransfers, type BudgetTransfer } from '../hooks/useTransfers'
import { useTransferBreakdown } from '../hooks/useTransferBreakdown'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BudgetYear {
  id: string
  year: number
  status: string
}

interface IncomeMember {
  userId: string
  name: string
  email: string
  monthlyAllocated: string
  monthlyAllocatedGross: string
  monthlyAllocatedNet: string
  sharePct: string
}

interface Category {
  id: string
  name: string
  icon: string | null
}

interface ExpenseItem {
  id: string
  label: string
  amount: string
  frequency: string
  frequencyPeriod: string | null
  monthlyEquivalent: string
  notes: string | null
  category: Category
}

interface ExpenseByCategory {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  totalMonthly: string
}

interface ExpenseByAccount {
  accountId: string
  accountName: string
  accountType: string
  totalMonthly: string
}

interface MemberSplit {
  userId: string
  name: string
  sharePct: string
  monthlyIncomeAllocated: string
  monthlySharedOwed: string
  monthlyIndividualOwed: string
  monthlyCustomOwed: string
  monthlyTotalOwed: string
}

interface Warnings {
  expensesExceedIncome: boolean
  noSavings: boolean
  uncategorisedExpenses: boolean
  unnamedSimulations: boolean
}

interface DashboardSummary {
  budgetYear: BudgetYear | null
  income: { totalMonthly: string; members: IncomeMember[] }
  expenses: { totalMonthly: string; items: ExpenseItem[]; byCategory: ExpenseByCategory[]; byAccount: ExpenseByAccount[] }
  savings: { totalMonthly: string }
  surplus: string
  memberSplits: MemberSplit[]
  warnings: Warnings
}

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
}

interface SavingsHistoryRow {
  year: number
  status: string
  totalMonthlyIncome: string
  totalMonthlySavings: string
  savingsRate: string | null
}



const MEMBER_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
const CATEGORY_COLORS = ['#6366f1', '#f97316', '#a78bfa', '#fb923c', '#34d399', '#f43f5e', '#22d3ee', '#fbbf24']

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()

  // DASH-002: monthly vs actual charge toggle
  const [expenseView, setExpenseView] = useState<'monthly' | 'actual'>('monthly')

  // DASH-003: dismissed warning keys
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // SAV-003: affordability slider (extra monthly savings)
  const [extraSavings, setExtraSavings] = useState(0)

  // Budget transfer state
  const [markPaidTransfer, setMarkPaidTransfer] = useState<BudgetTransfer | null>(null)
  const [markPaidAmount, setMarkPaidAmount] = useState('')
  const [markPaidLoading, setMarkPaidLoading] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)

  const { data: household } = useQuery<Household>({
    queryKey: ['household', householdId],
    queryFn: async () => (await api.get<Household>(`/households/${householdId}`)).data,
    enabled: !!householdId,
  })

  const { data: savingsHistory = [] } = useQuery<SavingsHistoryRow[]>({
    queryKey: ['savings-history', householdId],
    queryFn: async () => (await api.get<SavingsHistoryRow[]>(`/households/${householdId}/savings-history`)).data,
    enabled: !!householdId,
  })

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard', householdId],
    queryFn: async () => (await api.get<DashboardSummary>(`/households/${householdId}/summary`)).data,
    enabled: !!householdId,
  })

  const queryClient = useQueryClient()
  const { data: transfers = [] } = useTransfers(summary?.budgetYear?.id)
  const { data: transferBreakdown } = useTransferBreakdown(summary?.budgetYear?.id)
  const [breakdownCollapsed, setBreakdownCollapsed] = useState(true)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const pendingThisMonth = transfers.find(
    (t) => t.status === 'PENDING' && t.month === currentMonth && t.year === currentYear,
  )

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  async function handleMarkPaid() {
    if (!markPaidTransfer || !summary?.budgetYear) return
    setMarkPaidLoading(true)
    try {
      await api.patch(
        `/budget-years/${summary.budgetYear.id}/transfers/${markPaidTransfer.id}/mark-paid`,
        { actualAmount: parseFloat(markPaidAmount) },
      )
      queryClient.invalidateQueries({ queryKey: ['transfers', summary.budgetYear.id] })
      setMarkPaidTransfer(null)
    } finally {
      setMarkPaidLoading(false)
    }
  }

  async function handleRevert(transfer: BudgetTransfer) {
    if (!summary?.budgetYear) return
    await api.patch(
      `/budget-years/${summary.budgetYear.id}/transfers/${transfer.id}/mark-pending`,
    )
    queryClient.invalidateQueries({ queryKey: ['transfers', summary.budgetYear.id] })
  }

  function dismiss(key: string) {
    setDismissed((prev) => new Set([...prev, key]))
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const income = parseFloat(summary?.income.totalMonthly ?? '0')
  const expenses = parseFloat(summary?.expenses.totalMonthly ?? '0')
  const savings = parseFloat(summary?.savings.totalMonthly ?? '0')
  const surplus = parseFloat(summary?.surplus ?? '0')

  // SAV-002: savings rate
  const savingsRate = income > 0 ? (savings / income) * 100 : null

  // SAV-003: adjusted surplus after extra savings slider
  const adjustedSurplus = useMemo(() => surplus - extraSavings, [surplus, extraSavings])
  const sliderMax = useMemo(() => Math.max(Math.ceil(surplus / 100) * 100, 500), [surplus])

  // VIZ-001: income flow Sankey data
  const sankeyData = useMemo(() => {
    if (!summary?.budgetYear || income <= 0) return null
    const activeMembers = summary.income.members.filter((m) => parseFloat(m.monthlyAllocated) > 0)
    if (activeMembers.length === 0) return null
    const nodes: SankeyNodeDef[] = [
      ...activeMembers.map((m, i) => ({ id: `member_${m.userId}`, name: m.name, color: MEMBER_COLORS[i % MEMBER_COLORS.length] })),
      ...summary.expenses.byCategory.map((c, i) => ({ id: `cat_${c.categoryId}`, name: c.categoryName, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
      ...(savings > 0 ? [{ id: 'savings', name: 'Savings', color: '#3b82f6' }] : []),
      ...(surplus > 0 ? [{ id: 'surplus', name: 'Surplus', color: '#10b981' }] : []),
    ]
    const links: SankeyLinkDef[] = []
    for (const m of activeMembers) {
      const share = parseFloat(m.sharePct) / 100
      for (const c of summary.expenses.byCategory) {
        const val = parseFloat(c.totalMonthly) * share
        if (val > 0) links.push({ source: `member_${m.userId}`, target: `cat_${c.categoryId}`, value: val })
      }
      if (savings > 0) links.push({ source: `member_${m.userId}`, target: 'savings', value: savings * share })
      if (surplus > 0) links.push({ source: `member_${m.userId}`, target: 'surplus', value: surplus * share })
    }
    return { nodes, links }
  }, [summary, income, savings, surplus])

  const warnings = summary?.warnings
  const activeWarnings: { key: string; message: string }[] = []
  if (warnings?.expensesExceedIncome) activeWarnings.push({ key: 'expensesExceedIncome', message: 'Expenses exceed income — review your budget.' })
  if (warnings?.noSavings) activeWarnings.push({ key: 'noSavings', message: 'No savings entries for this budget year.' })
  if (warnings?.unnamedSimulations) activeWarnings.push({ key: 'unnamedSimulations', message: 'You have unnamed budget simulations.' })

  const visibleWarnings = activeWarnings.filter((w) => !dismissed.has(w.key))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">

      {/* Budget year badge */}
      {summary?.budgetYear && (
        <div className="mb-5">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            summary.budgetYear.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' : 'bg-blue-900/50 text-blue-300'
          }`}>
            {summary.budgetYear.year} · {summary.budgetYear.status}
          </span>
        </div>
      )}

      <h1 className="text-2xl font-semibold mb-1">{household?.name ?? '…'}</h1>
      <p className="text-gray-400 text-sm mb-6">Dashboard</p>

      {/* DASH-003: Warning banners */}
      {visibleWarnings.length > 0 && (
        <div className="space-y-2 mb-6">
          {visibleWarnings.map((w) => (
            <div
              key={w.key}
              className="flex items-center justify-between bg-amber-950/60 border border-amber-700/50 text-amber-300 px-4 py-3 rounded-lg text-sm"
            >
              <span>⚠ {w.message}</span>
              <button
                onClick={() => dismiss(w.key)}
                className="ml-4 text-amber-500 hover:text-amber-300 text-lg leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <PageLoader />
      ) : !summary?.budgetYear ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-2">No active budget year for this household.</p>
          <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300 text-sm">
            Set up expenses to create a budget year →
          </Link>
        </div>
      ) : (
        <>
          {/* DASH-001: Summary cards */}
          <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Income / mo</p>
              <p className="text-2xl font-bold text-amber-400">{fmt(income)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Expenses / mo</p>
              <p className="text-2xl font-bold text-white">{fmt(expenses)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Savings / mo</p>
              <p className="text-2xl font-bold text-white">{fmt(savings)}</p>
              {savingsRate !== null && (
                <p className="text-xs text-gray-500 mt-1">{savingsRate.toFixed(1)}% of income</p>
              )}
            </div>
            <div className={`bg-gray-900 border rounded-xl p-4 ${
              surplus < 0 ? 'border-red-800' : 'border-gray-800'
            }`}>
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Surplus / mo</p>
              <p className={`text-2xl font-bold ${surplus < 0 ? 'text-red-400' : 'text-green-400'}`}>
                {fmt(surplus)}
              </p>
            </div>
          </div>

          {/* SAV-003: Affordability calculator */}
          {surplus > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Affordability calculator</h2>
              <p className="text-gray-400 text-xs mb-4">What if I saved more each month?</p>
              <div className="flex items-center gap-4 mb-3">
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={10}
                  value={extraSavings}
                  onChange={(e) => setExtraSavings(Number(e.target.value))}
                  className="flex-1 accent-amber-400"
                />
                <span className="text-amber-400 font-bold tabular-nums w-24 text-right">
                  +{fmt(extraSavings)} / mo
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Remaining surplus</span>
                <span className={`font-bold tabular-nums text-lg ${adjustedSurplus < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {fmt(adjustedSurplus)} / mo
                </span>
              </div>
              {extraSavings > 0 && income > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Total savings rate would be {(((savings + extraSavings) / income) * 100).toFixed(1)}% of income
                </p>
              )}
              {extraSavings > 0 && (
                <button
                  onClick={() => setExtraSavings(0)}
                  className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {/* SAV-002: Savings rate history */}
          {savingsHistory.filter((r) => r.savingsRate !== null).length > 1 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Savings rate history</h2>
              <div className="space-y-2">
                {savingsHistory.filter((r) => r.savingsRate !== null).map((r) => {
                  const rate = parseFloat(r.savingsRate!)
                  return (
                    <div key={r.year} className="flex items-center gap-3">
                      <span className="text-gray-400 text-sm w-16 shrink-0">{r.year}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div
                          className="bg-amber-400/70 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(rate, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-300 text-sm tabular-nums w-12 text-right">{rate.toFixed(1)}%</span>
                      <span className={`text-xs w-14 text-right ${
                        r.status === 'ACTIVE' ? 'text-green-400' :
                        r.status === 'FUTURE' ? 'text-blue-400' : 'text-gray-600'
                      }`}>{r.status.toLowerCase()}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* HH-005: Member expense splits */}
          {summary.memberSplits.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Monthly obligations</h2>
              <div className={`grid gap-4 mb-4 ${summary.memberSplits.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {summary.memberSplits.map((m) => {
                  const isMe = m.userId === me?.id
                  const personal = parseFloat(m.monthlyIndividualOwed) + parseFloat(m.monthlyCustomOwed)
                  return (
                    <div
                      key={m.userId}
                      className={`rounded-xl p-5 border ${isMe ? 'bg-amber-950/30 border-amber-700/50' : 'bg-gray-900 border-gray-800'}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${isMe ? 'text-amber-300' : 'text-white'}`}>{m.name}</span>
                          {isMe && <span className="text-xs bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded-full">you</span>}
                        </div>
                        <span className="text-xs text-gray-500">{m.sharePct}% of gross income</span>
                      </div>
                      <div className="space-y-1.5 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Shared expenses</span>
                          <span className="text-gray-300 tabular-nums">{fmt(m.monthlySharedOwed)}</span>
                        </div>
                        {personal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Personal expenses</span>
                            <span className="text-gray-300 tabular-nums">{fmt(personal)}</span>
                          </div>
                        )}
                      </div>
                      <div className={`flex justify-between items-baseline border-t pt-3 ${isMe ? 'border-amber-800/40' : 'border-gray-800'}`}>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Amount to transfer / mo</span>
                        <span className={`text-xl font-bold tabular-nums ${isMe ? 'text-amber-400' : 'text-white'}`}>
                          {fmt(m.monthlyTotalOwed)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Expenses breakdown */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Expenses</h2>
              {/* DASH-002: monthly / actual toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium">
                <button
                  onClick={() => setExpenseView('monthly')}
                  className={`px-3 py-1.5 transition-colors ${expenseView === 'monthly' ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setExpenseView('actual')}
                  className={`px-3 py-1.5 transition-colors ${expenseView === 'actual' ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`}
                >
                  Actual charge
                </button>
              </div>
            </div>

            {summary.expenses.items.length === 0 ? (
              <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
                No plunder recorded yet.{' '}
                <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300">
                  Add expenses →
                </Link>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-left">
                      <th className="px-4 py-3 font-medium">Label</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium text-right">
                        {expenseView === 'monthly' ? 'Monthly equiv.' : 'Actual charge'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.expenses.items.map((e) => (
                      <tr key={e.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                        <td className="px-4 py-3 text-white">
                          {e.label}
                          {e.notes && <span className="ml-1.5 text-gray-600 text-xs" title={e.notes}>📝</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          <span className="flex items-center gap-1.5">
                            {e.category.icon && (
                              <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                            )}
                            {e.category.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                          {expenseView === 'monthly'
                            ? fmt(e.monthlyEquivalent)
                            : (
                              <>
                                {fmt(e.amount)}
                                <span className="text-gray-600 text-xs ml-1">{FREQ_LABELS[e.frequency] ?? e.frequency}</span>
                              </>
                            )
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 text-gray-300 font-medium">
                      <td colSpan={2} className="px-4 py-3">Total / month</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-400">{fmt(expenses)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Expenses by category */}
          {summary.expenses.byCategory.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">By category</h2>
              <div className="space-y-2">
                {summary.expenses.byCategory.map((c) => {
                  const pct = expenses > 0 ? (parseFloat(c.totalMonthly) / expenses) * 100 : 0
                  return (
                    <div key={c.categoryId} className="flex items-center gap-3">
                      <span className="text-gray-300 text-sm w-36 shrink-0 truncate flex items-center gap-1.5">
                        {c.categoryIcon && (
                          <CategoryIcon name={c.categoryIcon} size={14} className="text-gray-500 shrink-0" />
                        )}
                        {c.categoryName}
                      </span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div
                          className="bg-amber-400/70 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-sm tabular-nums w-20 text-right">{fmt(c.totalMonthly)}</span>
                      <span className="text-gray-600 text-xs w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {summary.expenses.byAccount?.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">By account</h2>
              <div className="space-y-2">
                {summary.expenses.byAccount.map((a) => {
                  const pct = expenses > 0 ? (parseFloat(a.totalMonthly) / expenses) * 100 : 0
                  return (
                    <div key={a.accountId} className="flex items-center gap-3">
                      <span className="text-gray-300 text-sm w-36 shrink-0 truncate flex items-center gap-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0">
                          {a.accountType.replace('_', ' ')}
                        </span>
                        {a.accountName}
                      </span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div
                          className="bg-blue-400/70 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-sm tabular-nums w-20 text-right">{fmt(a.totalMonthly)}</span>
                      <span className="text-gray-600 text-xs w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Budget transfer tile */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={16} className="text-amber-400" />
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Transfer due this month</h2>
              </div>
            </div>
            {pendingThisMonth ? (
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-amber-400">{fmt(pendingThisMonth.calculatedAmount)}</span>
                <button
                  onClick={() => {
                    setMarkPaidTransfer(pendingThisMonth)
                    setMarkPaidAmount(pendingThisMonth.calculatedAmount)
                  }}
                  className="bg-amber-500 hover:bg-amber-400 text-gray-950 font-medium text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  Mark as Paid
                </button>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No transfer pending this month</p>
            )}
          </div>

          {/* Transfer history */}
          <div className="mb-8">
            <button
              onClick={() => setHistoryCollapsed((c) => !c)}
              className="flex items-center gap-2 text-sm font-medium text-gray-400 uppercase tracking-wide mb-3 hover:text-gray-300 transition-colors"
            >
              <span>Transfer History</span>
              <span className="text-gray-600">{historyCollapsed ? '▸' : '▾'}</span>
            </button>
            {!historyCollapsed && (
              transfers.length === 0 ? (
                <p className="text-gray-600 text-sm py-4 text-center bg-gray-900 border border-gray-800 rounded-xl">
                  No transfers recorded yet
                </p>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-left">
                        <th className="px-4 py-3 font-medium">Month</th>
                        <th className="px-4 py-3 font-medium text-right">Calculated</th>
                        <th className="px-4 py-3 font-medium text-right">Actual</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t) => (
                        <tr key={t.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                          <td className="px-4 py-3 text-white tabular-nums">
                            {MONTH_NAMES[(t.month - 1) % 12]} {t.year}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmt(t.calculatedAmount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                            {t.actualAmount ? fmt(t.actualAmount) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              t.status === 'PAID' ? 'bg-green-900/50 text-green-300' :
                              t.status === 'ADJUSTED' ? 'bg-amber-900/50 text-amber-300' :
                              'bg-gray-800 text-gray-400'
                            }`}>
                              {t.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {t.status === 'PENDING' ? (
                              <button
                                onClick={() => {
                                  setMarkPaidTransfer(t)
                                  setMarkPaidAmount(t.calculatedAmount)
                                }}
                                className="text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors"
                              >
                                Mark as Paid
                              </button>
                            ) : (
                              <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
                                {t.paidAt && <span>{new Date(t.paidAt).toLocaleDateString()}</span>}
                                <button
                                  onClick={() => handleRevert(t)}
                                  className="text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                  Revert
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* Transfer breakdown by account and member */}
          {transferBreakdown && (transferBreakdown.byAccount.length > 0 || transferBreakdown.byMember.length > 0) && (
            <div className="mb-8">
              <button
                onClick={() => setBreakdownCollapsed((c) => !c)}
                className="flex items-center gap-2 text-sm font-medium text-gray-400 uppercase tracking-wide mb-3 hover:text-gray-300 transition-colors"
              >
                <span>Transfer Breakdown</span>
                <span className="text-gray-600">{breakdownCollapsed ? '▸' : '▾'}</span>
              </button>
              {!breakdownCollapsed && (
                <div className="space-y-4">
                  {/* By account */}
                  {transferBreakdown.byAccount.length > 0 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-800">
                        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide">By account</h3>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {transferBreakdown.byAccount.map((a) => (
                            <tr key={a.accountId ?? '__untagged__'} className="border-b border-gray-800 last:border-0">
                              <td className="px-4 py-3 text-white">
                                {a.accountName}
                                {a.accountType && (
                                  <span className="ml-2 text-xs text-gray-500">{a.accountType.replace('_', ' ')}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmt(a.monthlyAmount)}<span className="text-gray-600 text-xs">/mo</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {/* By member */}
                  {transferBreakdown.byMember.length > 0 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-800">
                        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide">By member</h3>
                      </div>
                      <div className="divide-y divide-gray-800">
                        {transferBreakdown.byMember.map((member) => (
                          <div key={member.userId} className="px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-white">{member.name}</span>
                              <span className="text-sm tabular-nums text-amber-400 font-medium">{fmt(member.monthlyTotal)}<span className="text-gray-600 text-xs font-normal">/mo</span></span>
                            </div>
                            {member.byAccount.length > 0 && (
                              <div className="space-y-1">
                                {member.byAccount.map((a) => (
                                  <div key={a.accountId ?? '__untagged__'} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500">{a.accountName}</span>
                                    <span className="tabular-nums text-gray-400">{fmt(a.monthlyAmount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mark as Paid modal */}
          {markPaidTransfer && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm">
                <h3 className="text-lg font-semibold text-white mb-1">Mark Transfer as Paid</h3>
                <p className="text-gray-400 text-sm mb-4">
                  {MONTH_NAMES[(markPaidTransfer.month - 1) % 12]} {markPaidTransfer.year}
                </p>
                <label className="block text-xs text-gray-400 uppercase tracking-wide mb-1">
                  Actual amount transferred
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={markPaidAmount}
                  onChange={(e) => setMarkPaidAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-amber-500"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleMarkPaid}
                    disabled={markPaidLoading || !markPaidAmount}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-medium text-sm py-2 rounded-lg transition-colors"
                  >
                    {markPaidLoading ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setMarkPaidTransfer(null)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIZ-001: Income flow diagram */}
          {sankeyData && sankeyData.links.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Income flow</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <SankeyChart data={sankeyData} currency={baseCurrency} />
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
