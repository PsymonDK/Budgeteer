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
/** Vertical distance between marks stacked on the same day */
const ROW = 14

type Phase = 'done' | 'due' | 'closed'
type MonthState = 'past' | 'current' | 'future'

/** Items the household ticks off itself: manually paid items with an occurrence this month. */
const ticksOff = (item: MonthPayment) => item.paymentMethod === 'MANUAL' && item.status != null

/**
 * Where the item stands. Items the household ticks off go by their status (paid or dismissed
 * is done); everything else (automatic items, and months before tracking) goes by the date.
 */
function phaseOf(item: MonthPayment, monthState: MonthState, todayDay: number): Phase {
  if (ticksOff(item)) return item.status === 'PAID' || item.status === 'DISMISSED' ? 'done' : item.status === 'SKIPPED' ? 'closed' : 'due'
  if (monthState === 'past') return 'done'
  if (monthState === 'future') return 'due'
  return item.day != null && item.day <= todayDay ? 'done' : 'due'
}

function phaseLabel(item: MonthPayment, phase: Phase): string {
  if (ticksOff(item)) {
    if (item.status === 'DISMISSED') return item.dismissReason === 'SKIPPED' ? 'Skipped this month' : 'Paid elsewhere'
    return phase === 'done' ? 'Paid' : phase === 'closed' ? 'Carried over' : 'To pay'
  }
  if (phase === 'due') return 'Coming up'
  return item.paymentMethod === 'MANUAL' ? 'Due date passed' : 'Gone out'
}

const methodLabel = (item: MonthPayment) => (item.paymentMethod === 'MANUAL' ? 'Manual' : 'Automatic')

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

/** A payment's mark: a circle when it's paid automatically, a diamond when paid by hand. */
function Mark({ manual, cx, cy, filled, color, dashed, opacity }: {
  manual: boolean; cx: number; cy: number; filled: boolean; color: string; dashed?: boolean; opacity?: number
}) {
  const common = {
    fill: filled ? color : SURFACE,
    stroke: filled ? SURFACE : color,
    strokeWidth: 2,
    strokeDasharray: dashed ? '2 2' : undefined,
    opacity,
  }
  if (manual) {
    const r = filled ? 6.5 : 5.5
    return <path d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} strokeLinejoin="round" {...common} />
  }
  return <circle cx={cx} cy={cy} r={filled ? 5 : 4.5} {...common} />
}

/**
 * The month's payments on a day-by-day line: each dated payment is a mark on its due day
 * (stacked when several share a day), a circle when it's paid automatically and a diamond
 * when it's paid by hand. Marks fill once paid (manual items in Pay/No-pay households) or
 * once their day has passed. The current month shows how far it has run. Hover or tap a
 * mark for details; "List" shows every payment as text.
 */
export function PaymentsTimeline({ data, fmt, today = new Date() }: { data: MonthPayments; fmt: Fmt; today?: Date }) {
  const [wrapRef, width] = useWidth(640)
  const [active, setActive] = useState<number | null>(null)
  const [showList, setShowList] = useState(false)

  const { year, month, items, totals } = data
  const lastDay = new Date(year, month, 0).getDate()
  const ym = year * 12 + month
  const todayYm = today.getFullYear() * 12 + today.getMonth() + 1
  const monthState: MonthState = ym < todayYm ? 'past' : ym > todayYm ? 'future' : 'current'
  const todayDay = today.getDate()

  const dated = items.filter((i) => i.day != null)
  const undated = items.filter((i) => i.day == null)
  // Items without a day have no date to go by, so they only have a status when ticked off
  const statusOf = (item: MonthPayment) => item.day == null && !ticksOff(item)
    ? null
    : phaseLabel(item, phaseOf(item, monthState, todayDay))

  // Stack marks that share a day
  const perDay = new Map<number, number>()
  const marks = dated.map((item) => {
    const level = perDay.get(item.day!) ?? 0
    perDay.set(item.day!, level + 1)
    return { item, level, phase: phaseOf(item, monthState, todayDay) }
  })
  const maxStack = Math.max(1, ...perDay.values())

  const base = 38 + (maxStack - 1) * ROW
  const height = base + 28
  const x = (d: number) => PAD_X + ((d - 1) * (width - 2 * PAD_X)) / (lastDay - 1)
  const cy = (level: number) => base - 14 - level * ROW

  // Labels on the 1st, every 5th and the last day, dropping a 5th that would crowd the last day
  const labelled = (d: number) => d === 1 || d === lastDay || (d % 5 === 0 && lastDay - d >= 3)

  const summary = `Payments across ${MONTH_LONG[month - 1]}: ${dated.length} on a set day${
    totals.manualCount ? `, ${totals.manualCount} paid by hand` : ''}${
    totals.manualCount ? ` (${totals.doneCount} done)` : ''}${
    undated.length ? `, ${undated.length} without a set day` : ''}.${
    monthState === 'current' ? ` Today is the ${todayDay}${ordinalSuffix(todayDay)}.` : ''}`

  const tip = active != null ? marks[active] : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-100">{MONTH_LONG[month - 1]}'s payments</h3>
        <div className="flex items-baseline gap-3 text-sm text-gray-400">
          <span>
            {totals.manualCount > 0 ? (
              <>
                <b className="text-gray-100 font-semibold">{totals.doneCount} of {totals.manualCount}</b> manual done
                {parseFloat(totals.unpaid) > 0 && <> · <span className="tabular-nums">{fmt(totals.unpaid)}</span> to pay</>}
                {' '}· {totals.count} {totals.count === 1 ? 'payment' : 'payments'}
              </>
            ) : (
              <>
                <b className="text-gray-100 font-semibold">{totals.count}</b> {totals.count === 1 ? 'payment' : 'payments'} · <span className="tabular-nums">{fmt(totals.due)}</span>
                {totals.count > 0 && <> · all automatic</>}
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
        <PaymentList items={items} statusOf={statusOf} month={month} fmt={fmt} />
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
                {marks.map(({ item, level, phase }, i) => (
                  <g key={`${item.kind}:${item.entryId}`}>
                    <Mark
                      manual={item.paymentMethod === 'MANUAL'}
                      cx={x(item.day!)}
                      cy={cy(level)}
                      filled={phase === 'done'}
                      color={phase === 'closed' ? SERIES_REST : item.kind === 'expense' ? ENTITY.expenses : ENTITY.savings}
                      dashed={phase === 'closed'}
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
                ))}
              </svg>

              {tip && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs shadow-lg"
                  style={{
                    left: Math.min(Math.max(x(tip.item.day!), 90), width - 90),
                    top: cy(tip.level) - 12,
                  }}
                >
                  <div className="font-semibold text-gray-100">{tip.item.label}</div>
                  <div className="text-gray-400">
                    {tip.item.day} {MONTH_SHORT[month - 1]} · <span className="tabular-nums text-gray-200">{fmt(tip.item.amount)}</span>
                  </div>
                  <div className="text-gray-400">{methodLabel(tip.item)} · {phaseLabel(tip.item, tip.phase)}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              None of this month's payments has a due day yet. Add one when you edit an expense or savings entry.
            </p>
          )}

          <Legend hasManual={totals.manualCount > 0} showToday={monthState === 'current'} />

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
                      {item.paymentMethod === 'MANUAL' && <span className="text-xs text-gray-500 shrink-0">manual</span>}
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

function LegendMark({ manual, filled }: { manual: boolean; filled: boolean }) {
  return (
    <svg width="14" height="14" aria-hidden="true">
      <Mark manual={manual} cx={7} cy={7} filled={filled} color={TICK_TEXT} />
    </svg>
  )
}

function Legend({ hasManual, showToday }: { hasManual: boolean; showToday: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-400">
      <span className="inline-flex items-center gap-1.5"><KindSwatch kind="expense" />Expense</span>
      <span className="inline-flex items-center gap-1.5"><KindSwatch kind="savings" />Savings</span>
      <span className="inline-flex items-center gap-1.5"><LegendMark manual={false} filled />Automatic</span>
      <span className="inline-flex items-center gap-1.5"><LegendMark manual filled />Manual</span>
      <span className="inline-flex items-center gap-1.5">
        <LegendMark manual={false} filled={false} />
        {hasManual ? 'Hollow: to pay or coming up' : 'Hollow: coming up'}
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
function PaymentList({ items, statusOf, month, fmt }: {
  items: MonthPayment[]
  statusOf: (item: MonthPayment) => string | null
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
            <td className="py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">
              {methodLabel(item)}
              {statusOf(item) && <> · {statusOf(item)}</>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
