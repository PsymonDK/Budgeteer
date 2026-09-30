import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

/**
 * When a column appears, by the table's own width (container query):
 * 1 always · 2 from 520px · 3 from 780px · 4 from 1150px · 5 from 1500px.
 */
export type ColumnPriority = 1 | 2 | 3 | 4 | 5

export interface DataColumn<T> {
  key: string
  header: ReactNode
  priority?: ColumnPriority
  align?: 'left' | 'right'
  /** Makes the header a sort button for this key. */
  sortKey?: string
  cell: (row: T) => ReactNode
  /** Shown under the first column's content while this column is hidden, so a phone loses nothing. */
  summary?: (row: T) => ReactNode
  /** Footer cell (e.g. a total). The first column's footer is the row label. */
  footer?: ReactNode
  className?: string
}

// Written out in full so Tailwind can find every class
const SHOW_CELL: Record<ColumnPriority, string> = {
  1: '',
  2: 'hidden @[520px]/table:table-cell',
  3: 'hidden @[780px]/table:table-cell',
  4: 'hidden @[1150px]/table:table-cell',
  5: 'hidden @[1500px]/table:table-cell',
}
const HIDE_SUMMARY: Record<ColumnPriority, string> = {
  1: 'hidden',
  2: '@[520px]/table:hidden',
  3: '@[780px]/table:hidden',
  4: '@[1150px]/table:hidden',
  5: '@[1500px]/table:hidden',
}

interface DataTableProps<T extends { id: string }> {
  rows: T[]
  /** The first column is the row's label and is always shown. */
  columns: DataColumn<T>[]
  sort?: { key: string; asc: boolean; onSort: (key: string) => void }
  selection?: { selectedIds: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void; label: (row: T) => string }
  /** Opens a row: the detail pane on wide screens, the edit form elsewhere. */
  onRowClick?: (row: T) => void
  /** Row shown in the detail pane. */
  activeId?: string | null
  rowActions?: (row: T) => ReactNode
  rowClassName?: (row: T) => string
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronsUpDown size={14} className="text-gray-700 ml-1" />
  return asc ? <ChevronUp size={14} className="text-amber-400 ml-1" /> : <ChevronDown size={14} className="text-amber-400 ml-1" />
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * Table for list pages. Columns drop out by priority as the table gets narrower and their values move
 * into a line under the row label; there is no fixed minimum width, so phones don't scroll sideways.
 */
export function DataTable<T extends { id: string }>({
  rows, columns, sort, selection, onRowClick, activeId, rowActions, rowClassName,
}: DataTableProps<T>) {
  const [first, ...rest] = columns
  const summarized = rest.filter((c) => c.summary && (c.priority ?? 1) > 1)
  const maxSummaryPriority = summarized.reduce<ColumnPriority>((max, c) => Math.max(max, c.priority ?? 1) as ColumnPriority, 1)
  const hasFooter = columns.some((c) => c.footer !== undefined)
  const allSelected = !!selection && rows.length > 0 && rows.every((r) => selection.selectedIds.has(r.id))
  const someSelected = !!selection && rows.some((r) => selection.selectedIds.has(r.id))

  function cellClass(c: DataColumn<T>) {
    return `${SHOW_CELL[c.priority ?? 1]} ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row) }
  }

  return (
    <div className="@container/table bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-left select-none">
              {selection && (
                <th className="pl-3 @[520px]/table:pl-4 pr-1 @[520px]/table:pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={selection.onToggleAll}
                    className="accent-amber-400 cursor-pointer"
                    aria-label="Select all"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={`px-3 @[520px]/table:px-4 py-3 font-medium whitespace-nowrap ${cellClass(c)}`}>
                  {sort && c.sortKey ? (
                    <button
                      onClick={() => sort.onSort(c.sortKey!)}
                      className={`hover:text-white inline-flex items-center ${c.align === 'right' ? 'ml-auto' : ''}`}
                    >
                      {c.header} <SortIcon active={sort.key === c.sortKey} asc={sort.asc} />
                    </button>
                  ) : c.header}
                </th>
              ))}
              {rowActions && <th className="relative px-3 @[520px]/table:px-4 py-3 w-px"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = activeId === row.id
              const selected = selection?.selectedIds.has(row.id)
              return (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => onRowKey(e, row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={onRowClick ? active : undefined}
                  className={`border-b border-gray-800 last:border-0 group focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-400 ${
                    onRowClick ? 'cursor-pointer' : ''
                  } ${active ? 'bg-gray-800/70 shadow-[inset_2px_0_0_theme(colors.amber.400)]' : selected ? 'bg-amber-400/5 hover:bg-gray-800/40' : 'hover:bg-gray-800/40'} ${rowClassName?.(row) ?? ''}`}
                >
                  {selection && (
                    <td className="pl-3 @[520px]/table:pl-4 pr-1 @[520px]/table:pr-2 py-3 w-8" onClick={stop}>
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={() => selection.onToggle(row.id)}
                        className="accent-amber-400 cursor-pointer"
                        aria-label={`Select ${selection.label(row)}`}
                      />
                    </td>
                  )}
                  <td className={`px-3 @[520px]/table:px-4 py-3 ${cellClass(first)}`}>
                    {first.cell(row)}
                    {summarized.length > 0 && (
                      <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 ${HIDE_SUMMARY[maxSummaryPriority]}`}>
                        {summarized.map((c) => (
                          <span key={c.key} className={`inline-flex items-center gap-1 ${HIDE_SUMMARY[c.priority ?? 1]}`}>{c.summary!(row)}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  {rest.map((c) => (
                    <td key={c.key} className={`px-3 @[520px]/table:px-4 py-3 ${cellClass(c)}`}>{c.cell(row)}</td>
                  ))}
                  {rowActions && (
                    <td className="px-3 @[520px]/table:px-4 py-3 text-right whitespace-nowrap" onClick={stop}>
                      {/* Hidden until hover only where the device can hover; always visible on touch screens */}
                      <div className="flex items-center justify-end gap-1 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        {rowActions(row)}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          {hasFooter && (
            <tfoot>
              <tr className="border-t border-gray-700 bg-gray-800/50">
                {selection && <td />}
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 @[520px]/table:px-4 py-3 ${i === 0 ? 'text-sm text-gray-400 font-medium' : ''} ${cellClass(c)}`}>{c.footer}</td>
                ))}
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Small icon button for `rowActions`. */
export function RowActionButton({ label, onClick, tone = 'default', hideWhenNarrow = false, children }: {
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  /** Hide below 520px table width, e.g. Edit when tapping the row already opens the form. */
  hideWhenNarrow?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${hideWhenNarrow ? 'hidden @[520px]/table:inline-flex' : 'inline-flex'} p-2 rounded-lg transition-colors ${tone === 'danger' ? 'text-gray-500 hover:text-red-400 hover:bg-red-950/40' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
    >
      {children}
    </button>
  )
}
