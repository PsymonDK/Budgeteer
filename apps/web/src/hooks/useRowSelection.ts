import { useState } from 'react'

/** Checkbox selection over table rows (by id), used for bulk edits. */
export function useRowSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /** Selects every row in `rows`, or deselects them all when they are already all selected. */
  function toggleSelectAll(rows: { id: string }[]) {
    if (rows.every((e) => selectedIds.has(e.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        rows.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        rows.forEach((e) => next.add(e.id))
        return next
      })
    }
  }

  return { selectedIds, setSelectedIds, toggleSelect, toggleSelectAll }
}
