import { CategoryIcon } from '../../components/CategoryIcon'
import { SelectAllHeaderCell, SelectRowCell } from '../../components/entries/RowSelection'
import { AccountBadge, OwnershipBadges } from '../../components/entries/EntryBadges'
import { FREQUENCIES } from '../../lib/constants'
import type { SavingsEntry } from './types'

interface SavingsTableProps {
  entries: SavingsEntry[]
  isReadOnly: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onEdit: (entry: SavingsEntry) => void
  onDelete: (entry: SavingsEntry) => void
  isFiltered: boolean
  totalMonthly: number
  baseCurrency: string
  fmt: (v: number | string, suffix?: string) => string
}

/** Selectable savings list with a monthly total footer. */
export function SavingsTable({
  entries: filteredEntries, isReadOnly, selectedIds, onToggleSelect: toggleSelect, onToggleSelectAll: toggleSelectAll,
  onEdit: openEdit, onDelete, isFiltered, totalMonthly, baseCurrency, fmt,
}: SavingsTableProps) {
  const colSpan = isReadOnly ? 5 : 7
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left">
            {!isReadOnly && (
              <SelectAllHeaderCell rows={filteredEntries} selectedIds={selectedIds} onToggleAll={toggleSelectAll} />
            )}
            <th className="px-4 py-3 font-medium">Label</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3 font-medium">Frequency</th>
            <th className="px-4 py-3 font-medium text-right">Amount</th>
            <th className="px-4 py-3 font-medium text-right">/ month</th>
            {!isReadOnly && <th className="relative px-4 py-3"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {filteredEntries.map((e) => (
            <tr key={e.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group${selectedIds.has(e.id) ? ' bg-amber-400/5' : ''}`}>
              {!isReadOnly && (
                <SelectRowCell checked={selectedIds.has(e.id)} onToggle={() => toggleSelect(e.id)} label={e.label} />
              )}
              <td className="px-4 py-3 text-white">
                <div className="flex items-center gap-2 flex-wrap">
                  {e.label}
                  <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
                  {e.notes && <span className="ml-1 text-gray-600 text-xs" title={e.notes}>📝</span>}
                  <AccountBadge account={e.account} />
                </div>
              </td>
              <td className="px-4 py-3 text-gray-300">
                {e.category ? (
                  <span className="flex items-center gap-1.5">
                    {e.category.icon && (
                      <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                    )}
                    {e.category.name}
                  </span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {FREQUENCIES.find((f) => f.value === e.frequency)?.label}
              </td>
              <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
                {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
              </td>
              <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">
                {fmt(parseFloat(e.monthlyEquivalent), '')}
                <span className="ml-1 text-xs text-gray-500">{baseCurrency}</span>
              </td>
              {!isReadOnly && (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(e)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                    <button onClick={() => onDelete(e)} className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-700 bg-gray-800/50">
            {/* Spans every column before "/ month"; the actions column (edit mode) gets its own empty cell */}
            <td colSpan={isReadOnly ? colSpan - 1 : colSpan - 2} className="px-4 py-3 text-sm text-gray-400 font-medium">
              Total{isFiltered ? ' (filtered)' : ''} — {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
            </td>
            <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">{fmt(totalMonthly)}</td>
            {!isReadOnly && <td />}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  )
}
