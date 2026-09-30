import type { ReactNode } from 'react'

export interface FilterOption {
  id: string
  label: string
  icon?: ReactNode
  /** Small text after the label, e.g. an account type. */
  hint?: string
  /** Number of rows with this value. */
  count: number
}

export interface FilterFacet {
  key: string
  title: string
  options: FilterOption[]
  /** Rows in the list; shown next to "All" (not every row needs a value, e.g. untagged accounts). */
  total: number
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/**
 * List page body with a filter column on the left on extra-large screens (2200px+). Below that the
 * column is hidden and pages keep their filter chips above the list (hide those with `ultra:hidden`).
 */
export function FilteredList({ facets, children }: { facets: FilterFacet[]; children: ReactNode }) {
  const shown = facets.filter((f) => f.options.length > 0)
  if (shown.length === 0) return <>{children}</>
  return (
    <div className="ultra:grid ultra:grid-cols-[15rem_minmax(0,1fr)] ultra:gap-6 ultra:items-start">
      <aside aria-label="Filters" className="hidden ultra:block sticky top-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-5">
        {shown.map((facet) => <FacetList key={facet.key} facet={facet} />)}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function FacetList({ facet }: { facet: FilterFacet }) {
  const { title, options, total, selected, onChange } = facet

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }

  const row = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
      active ? 'bg-gray-800 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
    }`

  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-gray-500 mb-2 px-2">{title}</h3>
      <div className="space-y-0.5">
        <button type="button" onClick={() => onChange(new Set())} aria-pressed={selected.size === 0} className={row(selected.size === 0)}>
          <span className="flex-1">All</span>
          <span className="text-xs text-gray-500 tabular-nums">{total}</span>
        </button>
        {options.map((o) => (
          <button key={o.id} type="button" onClick={() => toggle(o.id)} aria-pressed={selected.has(o.id)} className={row(selected.has(o.id))}>
            {o.icon}
            <span className="flex-1 truncate">
              {o.label}
              {o.hint && <span className="ml-1 text-xs text-gray-600">{o.hint}</span>}
            </span>
            <span className="text-xs text-gray-500 tabular-nums">{o.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
