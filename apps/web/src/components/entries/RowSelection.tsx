interface Row { id: string }

interface SelectAllHeaderCellProps {
  rows: Row[]
  selectedIds: Set<string>
  onToggleAll: () => void
}

/** Header checkbox that selects / deselects every visible row (indeterminate when partial). */
export function SelectAllHeaderCell({ rows, selectedIds, onToggleAll }: SelectAllHeaderCellProps) {
  return (
    <th className="pl-4 pr-2 py-3 w-8">
      <input
        type="checkbox"
        checked={rows.length > 0 && rows.every((e) => selectedIds.has(e.id))}
        ref={(el) => { if (el) el.indeterminate = rows.some((e) => selectedIds.has(e.id)) && !rows.every((e) => selectedIds.has(e.id)) }}
        onChange={onToggleAll}
        className="accent-amber-400 cursor-pointer"
        aria-label="Select all"
      />
    </th>
  )
}

interface SelectRowCellProps {
  checked: boolean
  onToggle: () => void
  label: string
}

/** Per-row selection checkbox cell. */
export function SelectRowCell({ checked, onToggle, label }: SelectRowCellProps) {
  return (
    <td className="pl-4 pr-2 py-3 w-8">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="accent-amber-400 cursor-pointer"
        aria-label={`Select ${label}`}
      />
    </td>
  )
}

interface BulkSelectionBarProps {
  count: number
  onEdit: () => void
  onClear: () => void
}

/** "N selected · Edit selected · Clear selection" bar above a selectable table. */
export function BulkSelectionBar({ count, onEdit, onClear }: BulkSelectionBarProps) {
  return (
    <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-lg px-4 py-2.5 mb-3">
      <span className="text-amber-400 text-sm font-medium">{count} selected</span>
      <button
        onClick={onEdit}
        className="text-sm bg-amber-400 text-gray-950 font-semibold px-3 py-1 rounded-lg hover:bg-amber-300 transition-colors"
      >
        Edit selected
      </button>
      <button
        onClick={onClear}
        className="text-xs text-gray-400 hover:text-white transition-colors ml-auto"
      >
        Clear selection
      </button>
    </div>
  )
}
