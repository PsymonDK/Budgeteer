import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { CategoryIcon } from '../components/CategoryIcon'
import { PageHeader } from '../components/PageHeader'
import { CategoryFilter } from '../components/CategoryFilter'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BudgetYearOption {
  id: string
  year: number
  status: 'ACTIVE' | 'FUTURE' | 'RETIRED' | 'SIMULATION'
  simulationName: string | null
}

interface SummaryLine {
  a: string
  b: string
  delta: string
}

interface ExpenseRow {
  status: 'unchanged' | 'changed' | 'new' | 'removed'
  label: string
  category: { id: string; name: string; icon?: string | null }
  frequency: string
  a: { id: string; amount: string; monthlyEquivalent: string; frequency: string } | null
  b: { id: string; amount: string; monthlyEquivalent: string; frequency: string } | null
  monthlyDelta: string
}

interface CompareResult {
  yearA: { id: string; year: number; status: string; simulationName: string | null }
  yearB: { id: string; year: number; status: string; simulationName: string | null }
  summary: {
    income: SummaryLine
    expenses: SummaryLine
    savings: SummaryLine
    surplus: SummaryLine
  }
  expenses: ExpenseRow[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Period = 'monthly' | 'quarterly' | 'annual'

const PERIOD_MULTIPLIER: Record<Period, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

const PERIOD_LABEL: Record<Period, string> = {
  monthly: '/ month',
  quarterly: '/ quarter',
  annual: '/ year',
}

const FREQ_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly', FORTNIGHTLY: 'Fortnightly', MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly', BIANNUAL: 'Every 6 months', ANNUAL: 'Annually',
}

function fmt(v: number, period: Period) {
  return (v * PERIOD_MULTIPLIER[period]).toLocaleString('en', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

function yearLabel(y: BudgetYearOption | { year: number; status: string; simulationName: string | null }) {
  if (y.status === 'SIMULATION') return `${y.year} — ${y.simulationName ?? 'Simulation'}`
  return `${y.year} (${y.status.charAt(0) + y.status.slice(1).toLowerCase()})`
}

function deltaClass(delta: number, invert = false) {
  if (Math.abs(delta) < 0.005) return 'text-gray-500'
  const positive = invert ? delta < 0 : delta > 0
  return positive ? 'text-green-400' : 'text-red-400'
}

function deltaSign(delta: number) {
  if (delta > 0.005) return '+'
  if (delta < -0.005) return ''
  return '±'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComparePage() {
  const { id: householdId } = useParams<{ id: string }>()

  const [yearIdA, setYearIdA] = useState('')
  const [yearIdB, setYearIdB] = useState('')

  // COMP-006: time period toggle
  const [period, setPeriod] = useState<Period>('monthly')

  // COMP-004: category filter
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set())

  // COMP-005: frequency filter
  const [filterFrequencies, setFilterFrequencies] = useState<Set<string>>(new Set())

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: allYears = [] } = useQuery<BudgetYearOption[]>({
    queryKey: ['budget-years', householdId],
    queryFn: async () => (await api.get<BudgetYearOption[]>(`/households/${householdId}/budget-years`)).data,
    enabled: !!householdId,
  })

  const canCompare = !!yearIdA && !!yearIdB && yearIdA !== yearIdB

  const { data: result, isLoading: comparing, isError } = useQuery<CompareResult>({
    queryKey: ['compare', householdId, yearIdA, yearIdB],
    queryFn: async () =>
      (await api.get<CompareResult>(`/households/${householdId}/compare?a=${yearIdA}&b=${yearIdB}`)).data,
    enabled: canCompare,
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const allCategories = useMemo(() => {
    if (!result) return []
    const map = new Map<string, { name: string; icon: string | null | undefined }>()
    for (const e of result.expenses) map.set(e.category.id, { name: e.category.name, icon: e.category.icon })
    return [...map.entries()]
      .map(([id, { name, icon }]) => ({ id, name, icon }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [result])

  const allFrequencies = useMemo(() => {
    if (!result) return []
    const set = new Set<string>()
    for (const e of result.expenses) {
      if (e.a) set.add(e.a.frequency)
      if (e.b) set.add(e.b.frequency)
    }
    return [...set]
  }, [result])

  const filteredExpenses = useMemo(() => {
    if (!result) return []
    return result.expenses.filter((e) => {
      if (filterCategories.size > 0 && !filterCategories.has(e.category.id)) return false
      if (filterFrequencies.size > 0) {
        const freq = e.b?.frequency ?? e.a?.frequency ?? ''
        if (!filterFrequencies.has(freq)) return false
      }
      return true
    })
  }, [result, filterCategories, filterFrequencies])

  function toggleFrequency(f: string) {
    setFilterFrequencies((prev) => {
      const next = new Set(prev)
      next.has(f) ? next.delete(f) : next.add(f)
      return next
    })
  }

  // ── Status row styling ─────────────────────────────────────────────────────

  function rowStyle(status: ExpenseRow['status']) {
    if (status === 'new')     return 'bg-green-950/30 border-green-900/40'
    if (status === 'removed') return 'bg-red-950/30 border-red-900/40'
    if (status === 'changed') return 'bg-amber-950/30 border-amber-900/40'
    return ''
  }

  function statusBadge(status: ExpenseRow['status']) {
    if (status === 'new')     return <span className="text-xs text-green-400 font-medium">new</span>
    if (status === 'removed') return <span className="text-xs text-red-400 font-medium">removed</span>
    if (status === 'changed') return <span className="text-xs text-amber-400 font-medium">changed</span>
    return null
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <PageHeader title="Compare Budgets" subtitle="Select two budget years or simulations to compare side by side." />

      {/* COMP-001: Year selectors */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Budget A (baseline)</label>
          <select
            value={yearIdA}
            onChange={(e) => setYearIdA(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">Select a budget…</option>
            {allYears.map((y) => (
              <option key={y.id} value={y.id} disabled={y.id === yearIdB}>{yearLabel(y)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Budget B (compare to)</label>
          <select
            value={yearIdB}
            onChange={(e) => setYearIdB(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">Select a budget…</option>
            {allYears.map((y) => (
              <option key={y.id} value={y.id} disabled={y.id === yearIdA}>{yearLabel(y)}</option>
            ))}
          </select>
        </div>
      </div>

      {!canCompare ? (
        <div className="text-center py-20 text-gray-600">
          <p>Select two different budget years above to start comparing.</p>
        </div>
      ) : comparing ? (
        <div className="text-gray-500 text-sm py-20 text-center">Loading comparison…</div>
      ) : isError ? (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load comparison.</div>
      ) : result ? (
        <>
          {/* COMP-006: Time period toggle */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wide">View as</span>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium">
                {(['monthly', 'quarterly', 'annual'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 capitalize transition-colors ${period === p ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600 inline-block" /> New</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600 inline-block" /> Removed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Changed</span>
            </div>
          </div>

          {/* COMP-003: Summary comparison cards */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {(
              [
                { key: 'income',   label: 'Income',   invert: false },
                { key: 'expenses', label: 'Expenses', invert: true  },
                { key: 'savings',  label: 'Savings',  invert: false },
                { key: 'surplus',  label: 'Surplus',  invert: false },
              ] as const
            ).map(({ key, label, invert }) => {
              const line = result.summary[key]
              const a = parseFloat(line.a)
              const b = parseFloat(line.b)
              const delta = parseFloat(line.delta)
              return (
                <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">{label}</p>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-gray-500 text-xs">A</span>
                    <span className="text-gray-300 tabular-nums text-sm">{fmt(a, period)}</span>
                  </div>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-gray-500 text-xs">B</span>
                    <span className="text-white tabular-nums text-sm font-medium">{fmt(b, period)}</span>
                  </div>
                  <div className={`text-right text-sm font-bold tabular-nums ${deltaClass(delta, invert)}`}>
                    {deltaSign(delta)}{fmt(delta, period)}
                    <span className="text-xs font-normal ml-1">{PERIOD_LABEL[period]}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* COMP-004 + COMP-005: Filters */}
          {(allCategories.length > 0 || allFrequencies.length > 0) && (
            <div className="flex flex-wrap gap-4 mb-4">
              {allCategories.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Categories</p>
                  <CategoryFilter
                    categories={allCategories}
                    selected={filterCategories}
                    onChange={setFilterCategories}
                  />
                </div>
              )}

              {allFrequencies.length > 1 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Frequency</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allFrequencies.map((f) => (
                      <button
                        key={f}
                        onClick={() => toggleFrequency(f)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          filterFrequencies.has(f)
                            ? 'bg-amber-400 text-gray-950 border-amber-400'
                            : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >
                        {FREQ_LABELS[f] ?? f}
                      </button>
                    ))}
                    {filterFrequencies.size > 0 && (
                      <button
                        onClick={() => setFilterFrequencies(new Set())}
                        className="text-xs px-2 text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* COMP-002: Side-by-side expense table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Expense</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Frequency</th>
                  <th className="px-4 py-3 font-medium text-right">
                    A <span className="text-gray-600 font-normal">{PERIOD_LABEL[period]}</span>
                  </th>
                  <th className="px-4 py-3 font-medium text-right">
                    B <span className="text-gray-600 font-normal">{PERIOD_LABEL[period]}</span>
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-600">
                      No plunder matches the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((e, i) => {
                    const monthlyA = e.a ? parseFloat(e.a.monthlyEquivalent) : 0
                    const monthlyB = e.b ? parseFloat(e.b.monthlyEquivalent) : 0
                    const delta = parseFloat(e.monthlyDelta)
                    return (
                      <tr
                        key={i}
                        className={`border-b border-gray-800/60 last:border-0 ${rowStyle(e.status)}`}
                      >
                        <td className="px-4 py-3 text-white">
                          {e.label}
                          {e.status !== 'unchanged' && (
                            <span className="ml-2">{statusBadge(e.status)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          <span className="flex items-center gap-1.5">
                            {e.category.icon && (
                              <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                            )}
                            {e.category.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {FREQ_LABELS[e.b?.frequency ?? e.a?.frequency ?? ''] ?? (e.b?.frequency ?? e.a?.frequency ?? '—')}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                          {e.a ? fmt(monthlyA, period) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-200">
                          {e.b ? fmt(monthlyB, period) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${deltaClass(delta, true)}`}>
                          {deltaSign(delta)}{fmt(Math.abs(delta), period)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {filteredExpenses.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-700 bg-gray-800/50">
                    <td colSpan={3} className="px-4 py-3 text-gray-400 font-medium text-sm">
                      Total{(filterCategories.size > 0 || filterFrequencies.size > 0) ? ' (filtered)' : ''}
                      <span className="text-gray-600 font-normal ml-1">{PERIOD_LABEL[period]}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300 font-medium">
                      {fmt(filteredExpenses.reduce((s, e) => s + (e.a ? parseFloat(e.a.monthlyEquivalent) : 0), 0), period)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white font-bold">
                      {fmt(filteredExpenses.reduce((s, e) => s + (e.b ? parseFloat(e.b.monthlyEquivalent) : 0), 0), period)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-bold ${deltaClass(
                      filteredExpenses.reduce((s, e) => s + parseFloat(e.monthlyDelta), 0), true
                    )}`}>
                      {(() => {
                        const d = filteredExpenses.reduce((s, e) => s + parseFloat(e.monthlyDelta), 0)
                        return `${deltaSign(d)}${fmt(Math.abs(d), period)}`
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      ) : null}
    </main>
  )
}
