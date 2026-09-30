import type { ReactNode } from 'react'

/**
 * Empty list / section. The title says plainly what's missing; the optional `aside` carries the
 * pirate voice in italic Caslon, and `action` is the next step (e.g. an Add button).
 */
export function EmptyState({ icon, title, aside, action, compact = false }: {
  icon?: ReactNode
  title: string
  aside?: string
  action?: ReactNode
  /** Less padding, for small tiles. */
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center text-center gap-2 border border-dashed border-gray-700 rounded-xl px-6 ${compact ? 'py-8' : 'py-14'}`}>
      {icon && <div className="text-gray-600 mb-1" aria-hidden="true">{icon}</div>}
      <p className="text-sm font-semibold text-gray-200">{title}</p>
      {aside && <p className="font-serif italic text-sm text-gray-400 max-w-prose">{aside}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
