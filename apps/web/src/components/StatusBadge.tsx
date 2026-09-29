import type { ReactNode } from 'react'
import { budgetYearStatusClass, RETIRED_STATUS_CLASS } from '../lib/budgetYear'

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

/** Budget-year status badge, coloured by status (active, future, simulation, retired). */
export function StatusBadge({ status, shape = 'tag', retiredClass = RETIRED_STATUS_CLASS, children }: StatusBadgeProps) {
  return (
    <span className={`text-xs font-medium ${shapeClass[shape]} ${budgetYearStatusClass(status, retiredClass)}`}>
      {children}
    </span>
  )
}
