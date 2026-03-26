import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../api/client'
import { PageLoader } from '../components/LoadingSpinner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  categoryId: string
  categoryName: string
  totalMonthly: string
}

interface TrendRow {
  budgetYearId: string
  year: number
  status: string
  totalMonthlyIncome: string
  totalMonthlyExpenses: string
  totalMonthlySavings: string
  surplus: string
  expensesByCategory: CategoryTotal[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | string) {
  return Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusBadgeClass(status: string) {
  if (status === 'ACTIVE') return 'bg-green-900/50 text-green-300'
  if (status === 'FUTURE') return 'bg-blue-900/50 text-blue-300'
  return 'bg-gray-800 text-gray-500'
}

const CHART_COLOURS = {
  income:   '#f59e0b',
  expenses: '#6366f1',
  savings:  '#10b981',
  surplus:  '#34d399',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoryPage() {
  const { id: householdId } = useParams<{ id: string }>()

  // HIST-002 category filter
  const [filterCategoryId, setFilterCategoryId] = useState<string>('')

  // HIST-001 expanded year for read-only summary
  const [expandedYearId, setExpandedYearId] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: trends = [], isLoading } = useQuery<TrendRow[]>({
    queryKey: ['trends', householdId],
    queryFn: async () => (await api.get<TrendRow[]>(`/households/${householdId}/trends`)).data,
    enabled: !!householdId,
  })

  const { data: expandedSummary } = useQuery({
    queryKey: ['dashboard', householdId, expandedYearId],
    queryFn: async () =>
      (await api.get(`/households/${householdId}/summary?budgetYearId=${expandedYearId}`)).data,
    enabled: !!expandedYearId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  // All categories across all years (for the filter dropdown)
  const allCategories = (() => {
    const map = new Map<string, string>()
    for (const row of trends) {
      for (const c of row.expensesByCategory) map.set(c.categoryId, c.categoryName)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  })()

  // Chart data — when a category is filtered, expenses = that category's total
  const chartData = trends.map((row) => {
    let expenses: number
    if (filterCategoryId) {
      const cat = row.expensesByCategory.find((c) => c.categoryId === filterCategoryId)
      expenses = cat ? parseFloat(cat.totalMonthly) : 0
    } else {
      expenses = parseFloat(row.totalMonthlyExpenses)
    }
    return {
      year: String(row.year),
      income: parseFloat(row.totalMonthlyIncome),
      expenses,
      savings: parseFloat(row.totalMonthlySavings),
      surplus: parseFloat(row.surplus),
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-1">Budget History</h1>
      <p className="text-gray-400 text-sm mb-8">Year-over-year view of all budget periods.</p>

      {isLoading ? (
        <PageLoader />
      ) : trends.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p>No budget years recorded yet.</p>
        </div>
      ) : (
        <>
          {/* HIST-002: Trend chart */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Year-over-year trend</h2>
              {allCategories.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Expenses filter:</span>
                  <select
                    value={filterCategoryId}
                    onChange={(e) => setFilterCategoryId(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">All categories</option>
                    {allCategories.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                  {filterCategoryId && (
                    <button
                      onClick={() => setFilterCategoryId('')}
                      className="text-xs text-gray-600 hover:text-gray-400"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              {chartData.length === 1 ? (
                // Single-year: show a simple stat row instead of a chart
                <div className="grid grid-cols-4 gap-4">
                  {(['income', 'expenses', 'savings', 'surplus'] as const).map((key) => (
                    <div key={key}>
                      <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{key}</p>
                      <p className="text-lg font-bold" style={{ color: CHART_COLOURS[key] }}>
                        {fmt(chartData[0][key])}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="year" tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#f3f4f6', fontWeight: 600 }}
                      itemStyle={{ color: '#d1d5db' }}
                      formatter={(value: number) => fmt(value)}
                    />
                    <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12, paddingTop: 16 }} />
                    <Bar dataKey="income"   name="Income"   fill={CHART_COLOURS.income}   radius={[3,3,0,0]} />
                    <Bar dataKey="expenses" name={filterCategoryId ? (allCategories.find(([id]) => id === filterCategoryId)?.[1] ?? 'Expenses') : 'Expenses'}
                         fill={CHART_COLOURS.expenses} radius={[3,3,0,0]} />
                    <Bar dataKey="savings"  name="Savings"  fill={CHART_COLOURS.savings}  radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* HIST-001: Timeline */}
          <section>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">Timeline</h2>
            <div className="space-y-3">
              {[...trends].reverse().map((row) => {
                const isExpanded = expandedYearId === row.budgetYearId
                const surplus = parseFloat(row.surplus)
                return (
                  <div key={row.budgetYearId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    {/* Year header row */}
                    <button
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors text-left"
                      onClick={() => setExpandedYearId(isExpanded ? null : row.budgetYearId)}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-semibold text-white">{row.year}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadgeClass(row.status)}`}>
                          {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <span className="text-gray-400">
                          Income <span className="text-amber-400 font-medium tabular-nums">{fmt(row.totalMonthlyIncome)}</span>
                        </span>
                        <span className="text-gray-400">
                          Expenses <span className="text-white font-medium tabular-nums">{fmt(row.totalMonthlyExpenses)}</span>
                        </span>
                        <span className="text-gray-400">
                          Surplus <span className={`font-medium tabular-nums ${surplus < 0 ? 'text-red-400' : 'text-green-400'}`}>{fmt(surplus)}</span>
                        </span>
                        {isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                      </div>
                    </button>

                    {/* Expanded summary */}
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-5 py-4">
                        {!expandedSummary ? (
                          <PageLoader />
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-4 mb-4 sm:grid-cols-4">
                              {[
                                { label: 'Income / mo',   value: expandedSummary.income?.totalMonthly,   colour: 'text-amber-400' },
                                { label: 'Expenses / mo', value: expandedSummary.expenses?.totalMonthly, colour: 'text-white' },
                                { label: 'Savings / mo',  value: expandedSummary.savings?.totalMonthly,  colour: 'text-white' },
                                { label: 'Surplus / mo',  value: expandedSummary.surplus,                colour: parseFloat(expandedSummary.surplus ?? '0') < 0 ? 'text-red-400' : 'text-green-400' },
                              ].map(({ label, value, colour }) => (
                                <div key={label} className="bg-gray-800/60 rounded-lg p-3">
                                  <p className="text-gray-500 text-xs mb-1">{label}</p>
                                  <p className={`text-lg font-bold tabular-nums ${colour}`}>{fmt(value ?? 0)}</p>
                                </div>
                              ))}
                            </div>

                            {/* By category */}
                            {row.expensesByCategory.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Expenses by category</p>
                                <div className="space-y-1.5">
                                  {row.expensesByCategory.map((c) => {
                                    const total = parseFloat(row.totalMonthlyExpenses)
                                    const pct = total > 0 ? (parseFloat(c.totalMonthly) / total) * 100 : 0
                                    return (
                                      <div key={c.categoryId} className="flex items-center gap-3">
                                        <span className="text-gray-400 text-xs w-32 shrink-0 truncate">{c.categoryName}</span>
                                        <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                                          <div className="bg-indigo-500/60 h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                                        </div>
                                        <span className="text-gray-400 text-xs tabular-nums w-20 text-right">{fmt(c.totalMonthly)}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="mt-3">
                              <Link
                                to={`/households/${householdId}/expenses?budgetYearId=${row.budgetYearId}`}
                                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                              >
                                View expenses →
                              </Link>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
