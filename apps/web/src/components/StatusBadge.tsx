import type { ReactNode } from 'react'
import { budgetYearStatusClass, budgetYearStatusMarker, RETIRED_STATUS_CLASS } from '../lib/budgetYear'

const shapeClass = {
  /** Square-ish tag used in tables. */
  tag: 'px-2 py-0.5 rounded',
  pill: 'px-2 py-0.5 rounded-full',
  pillLg: 'px-2.5 py-1 rounded-full',
}

interface StatusBadgeProps {
  status: string
  shape?: keyof typeof shapeClass
  /** Colour for RETIRED/unknown statuses. */
  retiredClass?: string
  children: ReactNode
}

/**
 * Budget-year status badge: colour by status (active, future, simulation, retired) plus a shape marker,
 * so the status is readable without colour. Ledger-style mono label.
 */
export function StatusBadge({ status, shape = 'tag', retiredClass = RETIRED_STATUS_CLASS, children }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider whitespace-nowrap ${shapeClass[shape]} ${budgetYearStatusClass(status, retiredClass)}`}>
      <span aria-hidden="true" className={`block w-1.5 h-1.5 shrink-0 ${budgetYearStatusMarker(status)}`} />
      {children}
    </span>
  )
}
