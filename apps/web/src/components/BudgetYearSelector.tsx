import type { BudgetYear } from '../api/types'
import { yearLabel } from '../lib/budgetYear'
import { StatusBadge } from './StatusBadge'

interface BudgetYearSelectorProps {
  budgetYears: BudgetYear[]
  activeBudgetYear: BudgetYear | null
  onSelect: (budgetYearId: string) => void
  isReadOnly: boolean
}

/**
 * Budget-year picker above the expenses and savings lists: a badge when the
 * household has one year, a select otherwise. Renders nothing without years.
 */
export function BudgetYearSelector({ budgetYears, activeBudgetYear, onSelect, isReadOnly }: BudgetYearSelectorProps) {
  if (budgetYears.length === 0) return null
  return (
    <div className="mb-6 flex items-center gap-3">
      {budgetYears.length === 1 ? (
        <StatusBadge status={activeBudgetYear?.status ?? ''} shape="pillLg">
          {activeBudgetYear ? yearLabel(activeBudgetYear) : ''}
        </StatusBadge>
      ) : (
        <select
          value={activeBudgetYear?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {budgetYears.map((y) => (
            <option key={y.id} value={y.id}>{yearLabel(y)}</option>
          ))}
        </select>
      )}
      {isReadOnly && (
        <span className="text-xs text-gray-600 italic">Read-only (retired)</span>
      )}
    </div>
  )
}
