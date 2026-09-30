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
