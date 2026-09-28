import { CategoryIcon } from '../../components/CategoryIcon'
import type { Frequency } from '../../lib/constants'
import type { Expense } from './types'

// ── EXP-005: Expense Calendar ─────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RECURRING_FREQS = new Set<Frequency>(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'])

// The schedule (which months each expense falls due in) comes from the API
function getMonthValues(expense: Expense): (number | null)[] {
  return expense.monthSchedule.map((v) => (v === null ? null : parseFloat(v)))
}

export function ExpenseCalendar({ expenses, fmt }: { expenses: Expense[]; fmt: (v: number | string) => string }) {
  const rows = expenses.map((e) => {
    const values = getMonthValues(e)
    return { expense: e, values, rowTotal: values.reduce<number>((s, v) => s + (v ?? 0), 0) }
  })

  const colTotals = Array.from({ length: 12 }, (_, i) =>
    rows.reduce<number>((s, r) => s + (r.values[i] ?? 0), 0)
  )
  const grandTotal = colTotals.reduce((s, v) => s + v, 0)
  const colMax = Math.max(...colTotals, 1)

  function heatBg(value: number) {
    const opacity = Math.round((value / colMax) * 40) + 5
    return { background: `rgba(251, 191, 36, ${opacity / 100})` }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr className="text-gray-400">
            <th className="sticky left-0 z-10 bg-gray-900 border-b border-r border-gray-800 px-3 py-2.5 text-left font-medium min-w-[180px]">
              Expense
            </th>
            {MONTHS.map((m) => (
              <th key={m} className="border-b border-gray-800 px-2 py-2.5 text-right font-medium min-w-[70px]">{m}</th>
            ))}
            <th className="border-b border-l border-gray-800 px-3 py-2.5 text-right font-medium min-w-[80px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ expense: e, values, rowTotal }) => (
            <tr key={e.id} className="group">
              <td className="sticky left-0 z-10 bg-gray-950 group-hover:bg-gray-900 border-b border-r border-gray-800/60 px-3 py-2 transition-colors">
                <div className="flex items-center gap-1.5">
                  {e.category.icon && (
                    <CategoryIcon name={e.category.icon} size={12} className="text-gray-600 shrink-0" />
                  )}
                  <span className="text-gray-200 truncate max-w-[140px]" title={e.label}>{e.label}</span>
                  {RECURRING_FREQS.has(e.frequency) && (
                    <span className="text-gray-600 shrink-0" title="Monthly recurring">↻</span>
                  )}
                </div>
              </td>
              {values.map((v, i) =>
                v === null ? (
                  <td key={i} className="border-b border-gray-800/40 px-2 py-2 text-right text-gray-700">—</td>
                ) : (
                  <td key={i} className="border-b border-gray-800/40 px-2 py-2 text-right tabular-nums text-gray-200" style={heatBg(v)}>
                    {fmt(v)}
                  </td>
                )
              )}
              <td className="border-b border-l border-gray-800/60 px-3 py-2 text-right tabular-nums text-amber-400 font-medium">
                {fmt(rowTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky left-0 z-10 bg-gray-900 border-t border-r border-gray-700 px-3 py-2.5 text-gray-400 font-medium">
              Monthly total
            </td>
            {colTotals.map((total, i) => (
              <td key={i} className="border-t border-gray-700 px-2 py-2.5 text-right tabular-nums text-gray-300 font-medium" style={heatBg(total)}>
                {fmt(total)}
              </td>
            ))}
            <td className="border-t border-l border-gray-700 px-3 py-2.5 text-right tabular-nums text-amber-400 font-bold">
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
