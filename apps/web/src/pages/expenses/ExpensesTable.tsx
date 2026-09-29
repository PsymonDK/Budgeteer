import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { CategoryIcon } from '../../components/CategoryIcon'
import { SelectAllHeaderCell, SelectRowCell } from '../../components/entries/RowSelection'
import { AccountBadge, OwnershipBadges } from '../../components/entries/EntryBadges'
import { FREQUENCIES } from '../../lib/constants'
import { monthRangeLabel } from './helpers'
import type { Expense, SortKey } from './types'

interface ExpensesTableProps {
  expenses: Expense[]
  isReadOnly: boolean
  /** Year of the viewed budget year, used to dim expenses that have already ended. */
  viewedYear: number | undefined
  sortKey: SortKey
  sortAsc: boolean
  onSort: (key: SortKey) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  isFiltered: boolean
  totalMonthly: number
  fmt: (v: number | string, suffix?: string) => string
}

function SortIcon({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (sortKey !== col) return <ChevronsUpDown size={14} className="text-gray-700 ml-1" />
  return sortAsc
    ? <ChevronUp size={14} className="text-amber-400 ml-1" />
    : <ChevronDown size={14} className="text-amber-400 ml-1" />
}

/** Sortable, selectable expense list with a monthly total footer. */
export function ExpensesTable({
  expenses: filtered, isReadOnly, viewedYear: activeYear, sortKey, sortAsc, onSort: handleSort,
  selectedIds, onToggleSelect: toggleSelect, onToggleSelectAll: toggleSelectAll, onEdit: openEdit, onDelete,
  isFiltered, totalMonthly, fmt,
}: ExpensesTableProps) {
  const totalLabelColSpan = isReadOnly ? 4 : 5
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left select-none">
            {!isReadOnly && (
              <SelectAllHeaderCell rows={filtered} selectedIds={selectedIds} onToggleAll={toggleSelectAll} />
            )}
            <th className="px-4 py-3 font-medium">
              <button onClick={() => handleSort('label')} className="hover:text-white flex items-center">
                Label <SortIcon col="label" sortKey={sortKey} sortAsc={sortAsc} />
              </button>
            </th>
            <th className="px-4 py-3 font-medium">
              <button onClick={() => handleSort('category')} className="hover:text-white flex items-center">
                Category <SortIcon col="category" sortKey={sortKey} sortAsc={sortAsc} />
              </button>
            </th>
            <th className="px-4 py-3 font-medium">
              <button onClick={() => handleSort('frequency')} className="hover:text-white flex items-center">
                Frequency <SortIcon col="frequency" sortKey={sortKey} sortAsc={sortAsc} />
              </button>
            </th>
            <th className="px-4 py-3 font-medium text-right">
              <button onClick={() => handleSort('amount')} className="hover:text-white flex items-center ml-auto">
                Amount <SortIcon col="amount" sortKey={sortKey} sortAsc={sortAsc} />
              </button>
            </th>
            <th className="px-4 py-3 font-medium text-right">
              <button onClick={() => handleSort('monthly')} className="hover:text-white flex items-center ml-auto">
                /month <SortIcon col="monthly" sortKey={sortKey} sortAsc={sortAsc} />
              </button>
            </th>
            {!isReadOnly && <th className="relative px-4 py-3"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => {
            // An expense has ended if its end month is behind today *in the viewed budget year*
            const now = new Date()
            const viewedYear = activeYear ?? now.getFullYear()
            const isPast = e.endMonth != null && (viewedYear < now.getFullYear() || (viewedYear === now.getFullYear() && e.endMonth < now.getMonth() + 1))
            const rangeLabel = monthRangeLabel(e.startMonth, e.endMonth)
            return (
            <tr key={e.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group${isPast ? ' opacity-50' : ''}${selectedIds.has(e.id) ? ' bg-amber-400/5' : ''}`}>
              {!isReadOnly && (
                <SelectRowCell checked={selectedIds.has(e.id)} onToggle={() => toggleSelect(e.id)} label={e.label} />
              )}
              <td className="px-4 py-3 text-white">
                <div className="flex items-center gap-2 flex-wrap">
                  {e.label}
                  {rangeLabel && (
                    <span className="text-xs bg-gray-700/60 text-gray-400 border border-gray-600/50 px-2 py-0.5 rounded-full">
                      {rangeLabel}
                    </span>
                  )}
                  <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
                  {e.notes && (
                    <span className="text-gray-600 text-xs" title={e.notes}>📝</span>
                  )}
                  <AccountBadge account={e.account} />
                </div>
              </td>
              <td className="px-4 py-3 text-gray-300">
                <span className="flex items-center gap-1.5">
                  {e.category.icon && (
                    <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                  )}
                  {e.category.name}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-300">
                {FREQUENCIES.find((f) => f.value === e.frequency)?.label}
                {e.frequencyPeriod && (
                  <span className="text-gray-500 text-xs ml-1">({e.frequencyPeriod})</span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
                {e.currencyCode && (
                  <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">
                {fmt(parseFloat(e.monthlyWhenActive))}
              </td>
              {!isReadOnly && (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(e)}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(e)}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              )}
            </tr>
          )})}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-700 bg-gray-800/50">
            <td colSpan={totalLabelColSpan} className="px-4 py-3 text-sm text-gray-400 font-medium">
              Total{isFiltered ? ' (filtered)' : ''} — {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
            </td>
            <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">
              {fmt(totalMonthly)}
            </td>
            {!isReadOnly && <td />}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  )
}
