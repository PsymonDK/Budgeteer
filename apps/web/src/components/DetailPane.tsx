import { useCallback, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useMediaQuery } from '../hooks/useMediaQuery'

/**
 * Row selection for list pages with a detail pane. From 1440px wide the selected row opens in a side
 * pane next to the list; below that, pages open their modal instead (`showsPane` is false).
 * The selection lives in `?selected=`, so it survives a resize and can be linked.
 */
export function useDetailSelection() {
  const [params, setParams] = useSearchParams()
  const showsPane = useMediaQuery('(min-width: 1440px)')
  const selectedId = params.get('selected')

  const select = useCallback((id: string | null) => {
    setParams((p) => {
      if (id) p.set('selected', id)
      else p.delete('selected')
      return p
    }, { replace: true })
  }, [setParams])

  return { selectedId: showsPane ? selectedId : null, select, showsPane }
}

/** List with the detail pane beside it (from 1440px); the pane stays in view while the list scrolls. */
export function ListWithDetail({ detail, children }: { detail: ReactNode; children: ReactNode }) {
  return (
    <div className={detail ? 'wide:grid wide:grid-cols-[minmax(0,1fr)_22rem] ultra:grid-cols-[minmax(0,1fr)_26rem] wide:gap-6 wide:items-start' : ''}>
      <div className="min-w-0">{children}</div>
      {detail && <aside className="hidden wide:block sticky top-4">{detail}</aside>}
    </div>
  )
}

/** Card chrome for a detail pane: title, close button, sections, and actions at the bottom. */
export function DetailPane({ eyebrow, title, subtitle, onClose, actions, children }: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl max-h-[calc(100dvh-8rem)] flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-gray-800">
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 mb-1">{eyebrow}</p>}
          <h2 className="text-lg font-semibold text-white break-words">{title}</h2>
          {subtitle && <div className="text-sm text-gray-400 mt-0.5">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="p-1 -m-1 text-gray-500 hover:text-white transition-colors" aria-label="Close details">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 divide-y divide-gray-800">{children}</div>
      {actions && <div className="flex flex-wrap gap-2 px-5 py-4 border-t border-gray-800">{actions}</div>}
    </div>
  )
}

/** A titled group inside a DetailPane. */
export function DetailSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="py-4 space-y-2 text-sm">
      {title && <h3 className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{title}</h3>}
      {children}
    </div>
  )
}

/** Label / value line inside a DetailSection. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 text-right tabular-nums min-w-0">{children}</span>
    </div>
  )
}
