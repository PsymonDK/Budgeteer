import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ArrowRight, AlertTriangle, PiggyBank, Briefcase, Receipt } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, Dot,
} from 'recharts'
import { api } from '../api/client'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { SankeyChart } from '../components/SankeyChart'
import { Sparkline } from '../components/Sparkline'
import { inputClass } from '../lib/styles'
import { useFmt, useBaseCurrency } from '../hooks/useFmt'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonalDashboard {
  income: {
    grossMonthly: string
    netMonthly: string
    allocatedAmount: string
    allocatedPct: string
    unallocatedAmount: string
    sparkline: { month: string; gross: number; net: number }[]
  }
  expenses: {
    personal: { monthlyEquivalent: string; sparkline: { label: string; amount: number }[] }
    householdShare: { monthlyEquivalent: string; sparkline: { label: string; amount: number }[] }
    total: { monthlyEquivalent: string }
  }
  savings: {
    monthlyEquivalent: string
    pctOfGross: string
    pctOfNet: string
    sparkline: { label: string; amount: number }[]
  }
  surplus: { amount: string; isPositive: boolean }
}

interface HouseholdSummary {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER'
  memberCount: number
  monthlyGrossIncome: string
  monthlyIncome: string
  monthlyExpenses: string
  monthlySavings: string
  monthlySurplus: string
  budgetYear: { id: string; year: number; status: string } | null
  warnings: { expensesExceedIncome: boolean; noSavings: boolean }
  previousYear: {
    year: number
    monthlyGrossIncome: string
    monthlyIncome: string
    monthlyExpenses: string
    monthlySavings: string
    monthlySurplus: string
  } | null
}

interface UserSummary {
  totals: { monthlyGrossIncome: string; monthlyIncome: string; monthlyExpenses: string; monthlySavings: string; monthlySurplus: string }
  previousTotals: { monthlyGrossIncome: string } | null
  householdCount: number
  households: HouseholdSummary[]
}

interface UserMe {
  preferences: { showDashboardSparklines: boolean } | null
}

interface NewHousehold { id: string; name: string }

interface IncomeTrend {
  months: string[]
  jobs: { id: string; name: string; monthly: number[]; monthlyNet: number[] }[]
  total: number[]
  totalNet: number[]
  bonuses: { jobId: string; month: string; amount: number; amountNet: number; label: string }[]
}

interface IncomeSankeyData {
  totalIncome: string
  nodes: { id: string; name: string; color?: string }[]
  links: { source: string; target: string; value: number }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16',
]

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-900/50 text-green-300',
  FUTURE: 'bg-blue-900/50 text-blue-300',
  RETIRED: 'bg-gray-800 text-gray-400',
  SIMULATION: 'bg-purple-900/50 text-purple-300',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(yyyymm: string): string {
  const [year, mon] = yyyymm.split('-')
  return new Date(Number(year), Number(mon) - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UserDashboardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState('')
  const [showGross, setShowGross] = useState(true)

  const { data: dashboard, isLoading: dashLoading } = useQuery<PersonalDashboard>({
    queryKey: ['me', 'dashboard'],
    queryFn: async () => (await api.get<PersonalDashboard>('/users/me/dashboard')).data,
  })

  const { data: summary, isLoading: summaryLoading } = useQuery<UserSummary>({
    queryKey: ['me', 'summary'],
    queryFn: async () => (await api.get<UserSummary>('/me/summary')).data,
  })

  const { data: me } = useQuery<UserMe>({
    queryKey: ['users-me'],
    queryFn: async () => (await api.get<UserMe>('/users/me')).data,
  })

  const { data: incomeTrend } = useQuery<IncomeTrend>({
    queryKey: ['income-trend-me'],
    queryFn: async () => (await api.get<IncomeTrend>('/users/me/income/trend')).data,
  })

  const { data: sankeyData } = useQuery<IncomeSankeyData>({
    queryKey: ['income-sankey-me'],
    queryFn: async () => (await api.get<IncomeSankeyData>('/users/me/income/sankey')).data,
  })

  const showSparklines = me?.preferences?.showDashboardSparklines ?? true

  const chartData = incomeTrend
    ? incomeTrend.months.map((m, i) => {
        const row: Record<string, unknown> = {
          month: formatMonth(m), monthKey: m,
          total: showGross ? incomeTrend.total[i] : incomeTrend.totalNet[i],
        }
        incomeTrend.jobs.forEach((j) => { row[j.name] = showGross ? j.monthly[i] : j.monthlyNet[i] })
        return row
      })
    : []

  const bonusMap = new Map<string, { jobId: string; amount: number; label: string }[]>()
  if (incomeTrend) {
    for (const b of incomeTrend.bonuses) {
      const key = `${b.jobId}::${b.month}`
      const arr = bonusMap.get(key) ?? []
      arr.push({ jobId: b.jobId, amount: showGross ? b.amount : b.amountNet, label: b.label })
      bonusMap.set(key, arr)
    }
  }

  const createMutation = useMutation({
    mutationFn: (householdName: string) => api.post<NewHousehold>('/households', { name: householdName }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['me', 'summary'] })
      setShowCreate(false)
      setName('')
      navigate(`/households/${res.data.id}`)
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setCreateError((err.response?.data as { error?: string })?.error ?? 'Failed to create household')
      }
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    createMutation.mutate(name)
  }

  const { households = [] } = summary ?? {}
  const isLoading = dashLoading || summaryLoading

  return (
    <div className="flex-1 flex flex-col">
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Your personal financial snapshot</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setCreateError('') }}
            className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + New household
          </button>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : (
          <>
            {/* ── Three primary tiles ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

              {/* Income tile */}
              <Link
                to="/income"
                className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Briefcase size={14} className="text-amber-400" />
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Income</p>
                </div>
                <p className="text-2xl font-bold text-amber-400">{fmt(dashboard?.income.grossMonthly ?? '0')}</p>
                <p className="text-xs text-gray-500 mt-0.5">Net: <span className="text-gray-300">{fmt(dashboard?.income.netMonthly ?? '0')}</span></p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Allocated</span>
                    <span className="text-gray-300">
                      {fmt(dashboard?.income.allocatedAmount ?? '0')}
                      <span className="text-gray-600 ml-1">({parseFloat(dashboard?.income.allocatedPct ?? '0').toFixed(0)}%)</span>
                    </span>
                  </div>
                  {parseFloat(dashboard?.income.unallocatedAmount ?? '0') > 0.005 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Unallocated</span>
                      <span className="text-amber-500">{fmt(dashboard?.income.unallocatedAmount ?? '0')}</span>
                    </div>
                  )}
                </div>
                {showSparklines && dashboard && dashboard.income.sparkline.length >= 2 && (
                  <div className="mt-4">
                    <Sparkline data={dashboard.income.sparkline.map((s) => ({ value: s.gross }))} color="#f59e0b" />
                  </div>
                )}
              </Link>

              {/* Expenses tile */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Receipt size={14} className="text-red-400" />
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Expenses</p>
                </div>
                <p className="text-2xl font-bold text-red-400">{fmt(dashboard?.expenses.total.monthlyEquivalent ?? '0')}</p>
                <p className="text-xs text-gray-600 mt-0.5">monthly total</p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Personal</span>
                    <span className="text-gray-300">{fmt(dashboard?.expenses.personal.monthlyEquivalent ?? '0')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Household share</span>
                    <span className="text-gray-300">{fmt(dashboard?.expenses.householdShare.monthlyEquivalent ?? '0')}</span>
                  </div>
                </div>
                {showSparklines && dashboard && dashboard.expenses.householdShare.sparkline.length >= 2 && (
                  <div className="mt-4">
                    <Sparkline data={dashboard.expenses.householdShare.sparkline.map((s) => ({ value: s.amount }))} color="#ef4444" />
                  </div>
                )}
              </div>

              {/* Savings tile */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <PiggyBank size={14} className="text-blue-400" />
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Savings</p>
                </div>
                <p className="text-2xl font-bold text-blue-400">{fmt(dashboard?.savings.monthlyEquivalent ?? '0')}</p>
                <p className="text-xs text-gray-600 mt-0.5">monthly total</p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">% of gross</span>
                    <span className="text-gray-300">{parseFloat(dashboard?.savings.pctOfGross ?? '0').toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">% of net</span>
                    <span className="text-gray-300">{parseFloat(dashboard?.savings.pctOfNet ?? '0').toFixed(1)}%</span>
                  </div>
                </div>
                {showSparklines && dashboard && dashboard.savings.sparkline.length >= 2 && (
                  <div className="mt-4">
                    <Sparkline data={dashboard.savings.sparkline.map((s) => ({ value: s.amount }))} color="#3b82f6" />
                  </div>
                )}
              </div>
            </div>

            {/* ── Surplus / deficit bar ── */}
            {dashboard && (
              <div className={`rounded-xl border px-5 py-4 mb-10 flex items-center justify-between ${
                dashboard.surplus.isPositive
                  ? 'bg-emerald-950/30 border-emerald-900/50'
                  : 'bg-red-950/30 border-red-900/50'
              }`}>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-0.5">
                    Monthly {dashboard.surplus.isPositive ? 'surplus' : 'deficit'}
                  </p>
                  <p className="text-xs text-gray-500">Net income − (expenses + savings)</p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${dashboard.surplus.isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {!dashboard.surplus.isPositive && '−'}{fmt(Math.abs(parseFloat(dashboard.surplus.amount)).toFixed(2))}
                </p>
              </div>
            )}

            {/* ── Households ── */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-200">Your households</h2>
            </div>

            {households.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <PiggyBank size={40} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2">No crews assembled yet</p>
                <p className="text-sm">Create a household to get started.</p>
              </div>
            ) : (
              <div className="space-y-3 mb-10">
                {households.map((h) => (
                  <HouseholdCard key={h.id} household={h} onClick={() => navigate(`/households/${h.id}`)} fmt={fmt} />
                ))}
              </div>
            )}

            {/* ── Income detail (Sankey + 12-month trend) ── */}
            <h2 className="text-base font-semibold text-gray-200 mt-2 mb-4">Income detail</h2>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <h3 className="text-sm font-semibold mb-4 text-gray-200">Income flow</h3>
              {sankeyData && sankeyData.nodes.length > 0 ? (
                <SankeyChart data={sankeyData} currency={baseCurrency} />
              ) : (
                <p className="text-gray-500 text-sm">No allocation data. Allocate income to households first.</p>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-200">12-month income trend</h3>
                <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                  <button onClick={() => setShowGross(true)}
                    className={`px-3 py-1.5 transition-colors ${showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Gross</button>
                  <button onClick={() => setShowGross(false)}
                    className={`px-3 py-1.5 transition-colors ${!showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Net</button>
                </div>
              </div>
              {incomeTrend && incomeTrend.jobs.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#f3f4f6' }}
                      itemStyle={{ color: '#d1d5db' }}
                    />
                    <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                    {incomeTrend.jobs.map((job, i) => (
                      <Line
                        key={job.id}
                        type="monotone"
                        dataKey={job.name}
                        stroke={JOB_COLORS[i % JOB_COLORS.length]}
                        strokeWidth={2}
                        dot={(props) => {
                          const { cx, cy, payload } = props
                          const monthKey = payload.monthKey as string
                          const hasBonuses = bonusMap.has(`${job.id}::${monthKey}`)
                          if (hasBonuses) {
                            const bonuses = bonusMap.get(`${job.id}::${monthKey}`)!
                            const tipText = bonuses.map((b) => `${b.label}: ${fmt(b.amount)}`).join(', ')
                            return (
                              <g key={`dot-${job.id}-${monthKey}`}>
                                <circle cx={cx} cy={cy} r={6} fill={JOB_COLORS[i % JOB_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
                                <title>{`Bonus: ${tipText}`}</title>
                              </g>
                            )
                          }
                          return <Dot key={`dot-${job.id}-${monthKey}`} {...props} r={3} />
                        }}
                      />
                    ))}
                    <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Total" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500 text-sm">No job income data found.</p>
              )}
            </div>

            <div className="pb-2">
              <Link to="/income" className="text-amber-400 hover:text-amber-300 text-sm transition-colors">
                Manage jobs &amp; salary →
              </Link>
            </div>
          </>
        )}
      </main>

      {showCreate && (
        <Modal title="New household" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className={inputClass}
                placeholder="e.g. Family Budget"
              />
            </div>
            {createError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{createError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HouseholdCard({ household: h, onClick, fmt }: { household: HouseholdSummary; onClick: () => void; fmt: (v: number | string) => string }) {
  const surplus = parseFloat(h.monthlySurplus)
  const surplusColor = surplus >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <button
      onClick={onClick}
      className="w-full bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 text-left transition-colors group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="text-base font-semibold text-white truncate">{h.name}</h3>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              h.myRole === 'ADMIN' ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-800 text-gray-400'
            }`}>
              {h.myRole === 'ADMIN' ? 'Admin' : 'Member'}
            </span>
            {h.budgetYear && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[h.budgetYear.status] ?? 'bg-gray-800 text-gray-400'}`}>
                {h.budgetYear.year} · {h.budgetYear.status}
              </span>
            )}
            {!h.budgetYear && <span className="text-xs text-gray-600">No active budget</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5">
            <Stat label="Income" value={h.monthlyGrossIncome} subLabel="Net" subValue={h.monthlyIncome} color="text-gray-200" fmt={fmt} />
            <Stat label="Expenses" value={h.monthlyExpenses} color="text-gray-200" fmt={fmt} />
            <Stat label="Savings" value={h.monthlySavings} color="text-gray-200" fmt={fmt} />
            <Stat label="Surplus (net)" value={h.monthlySurplus} color={surplusColor} fmt={fmt} />
          </div>
          {(h.warnings.expensesExceedIncome || h.warnings.noSavings) && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {h.warnings.expensesExceedIncome && (
                <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-full px-2 py-0.5">
                  <AlertTriangle size={10} /> Expenses exceed income
                </span>
              )}
              {h.warnings.noSavings && (
                <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800/50 border border-gray-700/30 rounded-full px-2 py-0.5">
                  <AlertTriangle size={10} /> No savings
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ArrowRight size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors mt-1" />
          <span className="text-xs text-gray-500">{h.memberCount} {h.memberCount === 1 ? 'member' : 'members'}</span>
        </div>
      </div>
    </button>
  )
}

function Stat({ label, value, subLabel, subValue, color, fmt }: {
  label: string; value: string; subLabel?: string; subValue?: string; color: string; fmt: (v: number | string) => string
}) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${color}`}>{fmt(value)}</p>
      {subLabel && subValue !== undefined && (
        <p className="text-xs text-gray-600">{subLabel}: {fmt(subValue)}</p>
      )}
    </div>
  )
}
