import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonthPayment, MonthPayments } from '../../api/types'
import { ENTITY, SERIES_REST } from '../../lib/charts'

type Fmt = (v: number | string) => string

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const SURFACE = 'rgb(var(--sea-900))'
const RULE = 'rgb(var(--sea-700))'
const TICK_TEXT = 'rgb(var(--sea-400))'
const TODAY = 'rgb(var(--plum-400))'

const PAD_X = 18
/** Vertical distance between dots stacked on the same day */
const ROW = 14

type Phase = 'done' | 'due' | 'closed'

/** Where the item stands: paid (tracked) or gone out already (untracked, by date), still to come, or closed. */
function phaseOf(item: MonthPayment, tracked: boolean, monthState: 'past' | 'current' | 'future', todayDay: number): Phase {
  if (tracked) return item.status === 'PAID' ? 'done' : item.status === 'SKIPPED' ? 'closed' : 'due'
  if (monthState === 'past') return 'done'
  if (monthState === 'future') return 'due'
  return item.day != null && item.day <= todayDay ? 'done' : 'due'
}

/** Width of the element the returned ref is attached to (measured before paint, then on resize). */
function useWidth(fallback: number) {
  const [width, setWidth] = useState(fallback)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)))
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(el)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  return [ref, width] as const
}

/**
 * The month's payments on a day-by-day line: each dated payment is a dot on its due day
 * (stacked when several share a day), filled once paid, or once gone out for households
 * that don't track payments. The current month shows how far it has run. Hover or tap a
 * dot for details; "List" shows every payment as text.
 */
export function PaymentsTimeline({ data, fmt, today = new Date() }: { data: MonthPayments; fmt: Fmt; today?: Date }) {
  const [wrapRef, width] = useWidth(640)
  const [active, setActive] = useState<number | null>(null)
  const [showList, setShowList] = useState(false)

  const { year, month, tracked, items, totals } = data
  const lastDay = new Date(year, month, 0).getDate()
  const ym = year * 12 + month
  const todayYm = today.getFullYear() * 12 + today.getMonth() + 1
  const monthState = ym < todayYm ? 'past' : ym > todayYm ? 'future' : 'current'
  const todayDay = today.getDate()

  const dated = items.filter((i) => i.day != null)
  const undated = items.filter((i) => i.day == null)

  // Stack dots that share a day
  const perDay = new Map<number, number>()
  const dots = dated.map((item) => {
    const level = perDay.get(item.day!) ?? 0
    perDay.set(item.day!, level + 1)
    return { item, level, phase: phaseOf(item, tracked, monthState, todayDay) }
  })
  const maxStack = Math.max(1, ...perDay.values())

  const base = 38 + (maxStack - 1) * ROW
  const height = base + 28
  const x = (d: number) => PAD_X + ((d - 1) * (width - 2 * PAD_X)) / (lastDay - 1)
  const cy = (level: number) => base - 14 - level * ROW

  // Labels on the 1st, every 5th and the last day, dropping a 5th that would crowd the last day
  const labelled = (d: number) => d === 1 || d === lastDay || (d % 5 === 0 && lastDay - d >= 3)

  const doneCount = dots.filter((d) => d.phase === 'done').length
  const summary = `Payments across ${MONTH_LONG[month - 1]}: ${dated.length} on a set day${
    tracked ? `, ${doneCount} paid` : ''}${undated.length ? `, ${undated.length} without a set day` : ''}.${
    monthState === 'current' ? ` Today is the ${todayDay}${ordinalSuffix(todayDay)}.` : ''}`

  const phaseText = (p: Phase) => tracked
    ? (p === 'done' ? 'Paid' : p === 'closed' ? 'Carried over' : 'Due')
    : (p === 'done' ? 'Gone out' : 'Coming up')

  const tip = active != null ? dots[active] : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-100">{MONTH_LONG[month - 1]}'s payments</h3>
        <div className="flex items-baseline gap-3 text-sm text-gray-400">
          <span>
            {tracked && totals.paidCount != null ? (
              <>
                <b className="text-gray-100 font-semibold">{totals.paidCount} of {totals.count}</b> paid
                {totals.unpaid && parseFloat(totals.unpaid) > 0 && <> · <span className="tabular-nums">{fmt(totals.unpaid)}</span> still due</>}
              </>
            ) : (
              <>
                <b className="text-gray-100 font-semibold">{totals.count}</b> {totals.count === 1 ? 'payment' : 'payments'} · <span className="tabular-nums">{fmt(totals.due)}</span>
              </>
            )}
          </span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setShowList((v) => !v)}
              aria-expanded={showList}
              className="font-mono text-[11px] uppercase tracking-widest text-amber-400 hover:text-amber-300"
            >
              {showList ? 'Timeline' : 'List'}
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing is due this month.</p>
      ) : showList ? (
        <PaymentList items={items} phaseOf={(i) => phaseText(phaseOf(i, tracked, monthState, todayDay))} month={month} fmt={fmt} />
      ) : (
        <>
          {dated.length > 0 ? (
            <div ref={wrapRef} className="relative" onPointerLeave={() => setActive(null)}>
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="block">
                {/* Day axis */}
                <line x1={x(1)} x2={x(lastDay)} y1={base} y2={base} stroke={RULE} />
                {Array.from({ length: lastDay }, (_, i) => i + 1).map((d) => (
                  <g key={d}>
                    <line x1={x(d)} x2={x(d)} y1={base} y2={base + (labelled(d) ? 7 : 4)} stroke={RULE} />
                    {labelled(d) && (
                      <text
                        x={d === 1 ? x(d) - 3 : x(d)}
                        y={base + 20}
                        textAnchor={d === 1 ? 'start' : 'middle'}
                        fill={TICK_TEXT}
                        className="font-mono text-[10px]"
                      >
                        {d === 1 ? `1 ${MONTH_SHORT[month - 1]}` : d}
                      </text>
                    )}
                  </g>
                ))}

                {/* The month so far, and today */}
                {monthState === 'current' && (
                  <g aria-hidden="true">
                    <line x1={x(1)} x2={x(todayDay)} y1={base} y2={base} stroke={TODAY} strokeWidth={2} />
                    <line x1={x(todayDay)} x2={x(todayDay)} y1={16} y2={base} stroke={TODAY} strokeWidth={1.5} />
                    <path d={`M${x(todayDay) - 5} ${base - 1}l5 -8 5 8z`} fill={TODAY} />
                    <text
                      x={todayDay > lastDay / 2 ? x(todayDay) - 6 : x(todayDay) + 6}
                      y={11}
                      textAnchor={todayDay > lastDay / 2 ? 'end' : 'start'}
                      fill={TODAY}
                      className="font-mono text-[10px] font-medium"
                    >
                      TODAY · {todayDay} {MONTH_SHORT[month - 1].toUpperCase()}
                    </text>
                  </g>
                )}

                {/* Payments */}
                {dots.map(({ item, level, phase }, i) => {
                  const color = phase === 'closed' ? SERIES_REST : item.kind === 'expense' ? ENTITY.expenses : ENTITY.savings
                  const filled = phase === 'done'
                  return (
                    <g key={`${item.kind}:${item.entryId}`}>
                      <circle
                        cx={x(item.day!)}
                        cy={cy(level)}
                        r={filled ? 5 : 4.5}
                        fill={filled ? color : SURFACE}
                        stroke={filled ? SURFACE : color}
                        strokeWidth={2}
                        strokeDasharray={phase === 'closed' ? '2 2' : undefined}
                        opacity={active != null && active !== i ? 0.45 : 1}
                      />
                      {/* Larger hit target than the mark */}
                      <circle
                        cx={x(item.day!)}
                        cy={cy(level)}
                        r={9}
                        fill="transparent"
                        onPointerEnter={() => setActive(i)}
                        onPointerDown={() => setActive(i)}
                      />
                    </g>
                  )
                })}
              </svg>

              {tip && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs shadow-lg"
                  style={{
                    left: Math.min(Math.max(x(tip.item.day!), 80), width - 80),
                    top: cy(tip.level) - 12,
                  }}
                >
                  <div className="font-semibold text-gray-100">{tip.item.label}</div>
                  <div className="text-gray-400">
                    {tip.item.day} {MONTH_SHORT[month - 1]} · <span className="tabular-nums text-gray-200">{fmt(tip.item.amount)}</span> · {phaseText(tip.phase)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              None of this month's payments has a due day yet. Add one when you edit an expense or savings entry.
            </p>
          )}

          <Legend tracked={tracked} showToday={monthState === 'current'} />

          {undated.length > 0 && (
            <div className="border-t border-gray-800 pt-3">
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-400 mb-2">No set day</p>
              <ul className="grid gap-x-6 gap-y-1 @xl:grid-cols-2 @5xl:grid-cols-3">
                {undated.map((item) => (
                  <li key={`${item.kind}:${item.entryId}`} className="flex items-baseline justify-between gap-3 text-sm min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                      <KindSwatch kind={item.kind} />
                      <span className="truncate text-gray-200">{item.label}</span>
                      {item.recurrence && (
                        <span className="text-xs text-gray-500 shrink-0">{item.recurrence === 'WEEKLY' ? 'weekly' : 'fortnightly'}</span>
                      )}
                    </span>
                    <span className="tabular-nums text-gray-300 shrink-0">{fmt(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ordinalSuffix(day: number) {
  if (day >= 11 && day <= 13) return 'th'
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
}

function KindSwatch({ kind }: { kind: MonthPayment['kind'] }) {
  return (
    <span
      aria-label={kind === 'expense' ? 'Expense' : 'Savings'}
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ background: kind === 'expense' ? ENTITY.expenses : ENTITY.savings }}
    />
  )
}

function Legend({ tracked, showToday }: { tracked: boolean; showToday: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-400">
      <span className="inline-flex items-center gap-1.5"><KindSwatch kind="expense" />Expense</span>
      <span className="inline-flex items-center gap-1.5"><KindSwatch kind="savings" />Savings</span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill={TICK_TEXT} /></svg>
        {tracked ? 'Paid' : 'Gone out'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke={TICK_TEXT} strokeWidth="2" /></svg>
        {tracked ? 'Due' : 'Coming up'}
      </span>
      {showToday && (
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="12" aria-hidden="true"><path d="M1 6h12" stroke={TODAY} strokeWidth="2" /></svg>
          Month so far
        </span>
      )}
    </div>
  )
}

/** The same payments as text: the timeline's table view. */
function PaymentList({ items, phaseOf, month, fmt }: {
  items: MonthPayment[]
  phaseOf: (item: MonthPayment) => string
  month: number
  fmt: Fmt
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sr-only">
        <tr><th>Day</th><th>Payment</th><th>Amount</th><th>Status</th></tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.kind}:${item.entryId}`} className="border-t border-gray-800 first:border-t-0">
            <td className="py-1.5 pr-3 font-mono text-xs text-gray-400 whitespace-nowrap">
              {item.day != null ? `${item.day} ${MONTH_SHORT[month - 1]}` : item.recurrence ? (item.recurrence === 'WEEKLY' ? 'Weekly' : 'Fortnightly') : '—'}
            </td>
            <td className="py-1.5 pr-3 min-w-0">
              <span className="flex items-center gap-2 min-w-0">
                <KindSwatch kind={item.kind} />
                <span className="truncate text-gray-200">{item.label}</span>
              </span>
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-gray-200 whitespace-nowrap">{fmt(item.amount)}</td>
            <td className="py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">{item.day != null || item.status ? phaseOf(item) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
