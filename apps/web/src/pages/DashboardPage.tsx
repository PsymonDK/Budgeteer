import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { CategoryIcon } from '../components/CategoryIcon'

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

interface MemberSplit {
  userId: string
  name: string
  sharePct: string
  monthlyIncomeAllocated: string
  monthlyExpensesOwed: string
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
  expenses: { totalMonthly: string; items: ExpenseItem[]; byCategory: ExpenseByCategory[] }
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | string) {
  return Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FREQ_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly', FORTNIGHTLY: 'Fortnightly', MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly', BIANNUAL: 'Every 6 months', ANNUAL: 'Annually',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()

  // DASH-002: monthly vs actual charge toggle
  const [expenseView, setExpenseView] = useState<'monthly' | 'actual'>('monthly')

  // DASH-003: dismissed warning keys
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // SAV-003: affordability slider (extra monthly savings)
  const [extraSavings, setExtraSavings] = useState(0)

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

  const warnings = summary?.warnings
  const activeWarnings: { key: string; message: string }[] = []
  if (warnings?.expensesExceedIncome) activeWarnings.push({ key: 'expensesExceedIncome', message: 'Expenses exceed income — review your budget.' })
  if (warnings?.noSavings) activeWarnings.push({ key: 'noSavings', message: 'No savings entries for this budget year.' })
  if (warnings?.unnamedSimulations) activeWarnings.push({ key: 'unnamedSimulations', message: 'You have unnamed budget simulations.' })

  const visibleWarnings = activeWarnings.filter((w) => !dismissed.has(w.key))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">

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
        <div className="text-gray-500 text-sm py-20 text-center">Loading…</div>
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

          {/* Member splits */}
          {summary.memberSplits.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Member expense splits</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-left">
                      <th className="px-4 py-3 font-medium">Member</th>
                      <th className="px-4 py-3 font-medium text-right">Income / mo</th>
                      <th className="px-4 py-3 font-medium text-right">Share</th>
                      <th className="px-4 py-3 font-medium text-right">Expenses owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.memberSplits.map((m) => (
                      <tr key={m.userId} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                        <td className="px-4 py-3 text-white">
                          {m.name}
                          {m.userId === me?.id && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{fmt(m.monthlyIncomeAllocated)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 bg-gray-800 rounded-full h-1.5">
                              <div
                                className="bg-amber-400 h-1.5 rounded-full"
                                style={{ width: `${Math.min(parseFloat(m.sharePct), 100)}%` }}
                              />
                            </div>
                            <span className="text-gray-300 tabular-nums w-10 text-right">{m.sharePct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">{fmt(m.monthlyExpensesOwed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                No expenses yet.{' '}
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
        </>
      )}
    </main>
  )
}
