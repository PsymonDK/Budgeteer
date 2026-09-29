import type { ReactNode } from 'react'

/**
 * Dashboard grid that adds columns as it gets wider — 1, 2 (600px+), 3 (960px+), 4 (1400px+), 6 (2200px+).
 * It measures its own width (container query), so a collapsed sidebar gives more columns too.
 * Rows are packed densely: a smaller widget later in the list fills a gap left by a wide one.
 */
export function WidgetGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container/widgets">
      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 @[600px]/widgets:grid-cols-2 @[960px]/widgets:grid-cols-3 @[1400px]/widgets:grid-cols-4 @[1400px]/widgets:gap-5 @[2200px]/widgets:grid-cols-6 @[2200px]/widgets:gap-6">
        {children}
      </div>
    </div>
  )
}

/** Columns a widget spans at each column count; a missing count inherits the next smaller one (default 1). */
export interface WidgetSpan {
  2?: 1 | 2
  3?: 1 | 2 | 3
  4?: 1 | 2 | 3 | 4
  6?: 1 | 2 | 3 | 4 | 5 | 6
}

// Written out in full so Tailwind can find every class
const SPAN_CLASS = {
  2: { 1: '@[600px]/widgets:col-span-1', 2: '@[600px]/widgets:col-span-2' },
  3: { 1: '@[960px]/widgets:col-span-1', 2: '@[960px]/widgets:col-span-2', 3: '@[960px]/widgets:col-span-3' },
  4: {
    1: '@[1400px]/widgets:col-span-1', 2: '@[1400px]/widgets:col-span-2',
    3: '@[1400px]/widgets:col-span-3', 4: '@[1400px]/widgets:col-span-4',
  },
  6: {
    1: '@[2200px]/widgets:col-span-1', 2: '@[2200px]/widgets:col-span-2', 3: '@[2200px]/widgets:col-span-3',
    4: '@[2200px]/widgets:col-span-4', 5: '@[2200px]/widgets:col-span-5', 6: '@[2200px]/widgets:col-span-6',
  },
} as const

/**
 * One dashboard tile. Its child fills the grid cell's height, so tiles in a row line up.
 * The widget is itself a container, so its content can adapt with `@md:` etc. Renders
 * nothing (and takes no cell) when its child renders nothing.
 */
export function Widget({ span = {}, children }: { span?: WidgetSpan; children: ReactNode }) {
  const classes = [
    span[2] && SPAN_CLASS[2][span[2]],
    span[3] && SPAN_CLASS[3][span[3]],
    span[4] && SPAN_CLASS[4][span[4]],
    span[6] && SPAN_CLASS[6][span[6]],
  ].filter(Boolean).join(' ')
  return (
    <section className={`@container min-w-0 flex flex-col empty:hidden [&>*]:flex-1 ${classes}`}>
      {children}
    </section>
  )
}
