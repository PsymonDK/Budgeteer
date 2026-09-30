import { Link } from 'react-router-dom'
import { CategoryIcon } from '../../components/CategoryIcon'
import { FREQ_LABELS } from '../../lib/constants'
import { segmentGroup, segmentBtn } from '../../lib/styles'
import type { DashboardSummary } from './types'

interface ExpenseListProps {
  summary: DashboardSummary
  /** Total monthly expenses (for the footer). */
  expenses: number
  expenseView: 'monthly' | 'actual'
  setExpenseView: (view: 'monthly' | 'actual') => void
  householdId: string | undefined
  fmt: (v: number | string) => string
}

/**
 * Expense list (monthly equivalent or actual charge). Scrolls inside its tile, with the header and
 * total kept in view, so a long list doesn't stretch the dashboard row it sits in.
 */
export function ExpenseList({ summary, expenses, expenseView, setExpenseView, householdId, fmt }: ExpenseListProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Expenses</h2>
        {/* DASH-002: monthly / actual toggle */}
        <div className={segmentGroup}>
          <button
            onClick={() => setExpenseView('monthly')}
            className={segmentBtn(expenseView === 'monthly')}
          >
            Monthly
          </button>
          <button
            onClick={() => setExpenseView('actual')}
            className={segmentBtn(expenseView === 'actual')}
          >
            Actual charge
          </button>
        </div>
      </div>

      {summary.expenses.items.length === 0 ? (
        <div className="flex-1 text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
          No plunder recorded yet.{' '}
          <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300">
            Add expenses →
          </Link>
        </div>
      ) : (
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[32rem]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900">
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
            <tfoot className="sticky bottom-0 bg-gray-900">
              <tr className="border-t border-gray-700 text-gray-300 font-medium">
                <td colSpan={2} className="px-4 py-3">Total / month</td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-400">{fmt(expenses)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

interface BreakdownProps {
  summary: DashboardSummary
  /** Total monthly expenses (for each row's share). */
  expenses: number
  fmt: (v: number | string) => string
}

/** Monthly expenses per category as bars. Renders nothing when there are no categories. */
export function CategoryBreakdown({ summary, expenses, fmt }: BreakdownProps) {
  if (summary.expenses.byCategory.length === 0) return null
  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">By category</h2>
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
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
  )
}

/** Monthly expenses per household account as bars. Renders nothing when no account is used. */
export function AccountBreakdown({ summary, expenses, fmt }: BreakdownProps) {
  if (!(summary.expenses.byAccount?.length > 0)) return null
  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">By account</h2>
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
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
  )
}
