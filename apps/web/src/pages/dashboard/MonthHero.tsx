import { Check, TriangleAlert } from 'lucide-react'
import { useMonthPayments } from '../../api/queries'
import type { PaymentMethod } from '../../api/types'
import type { BudgetTransfer } from '../../hooks/useTransfers'
import { ENTITY } from '../../lib/charts'
import { primaryBtn } from '../../lib/styles'
import { PaymentsTimeline } from './PaymentsTimeline'
import type { DashboardSummary } from './types'

type Fmt = (v: number | string, suffix?: string) => string

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthHeroProps {
  budgetYearId: string
  income: number
  expenses: number
  savings: number
  surplus: number
  incomeSplit: DashboardSummary['incomeSplit']
  nextPending: BudgetTransfer | null
  /** Automatic transfers are marked paid on their due day and show no Mark-as-paid button */
  transferPaymentMethod: PaymentMethod
  transferDueDay: number
  /** This month's transfer, shown when the transfer is automatic */
  currentTransfer: BudgetTransfer | null
  /** The signed-in member's monthly share of the transfer, when the household splits it */
  myShare: number | null
  onMarkPaid: (t: BudgetTransfer) => void
  baseCurrency: string
  fmt: Fmt
}

/** The due day within a month: days past its end fall on its last day. */
const dueDayIn = (dueDay: number, year: number, month: number) => Math.min(dueDay, new Date(year, month, 0).getDate())

function ordinal(day: number) {
  const suffix = day >= 11 && day <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
  return `${day}${suffix}`
}

/** A big figure with small decimals and the currency code, like "17,650.00 DKK". */
function Figure({ value, currency, className }: { value: number; currency: string; className: string }) {
  const [whole, decimals] = Math.abs(value).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split('.')
  return (
    <span className={`font-display tabular-nums leading-none ${className}`}>
      {value < 0 && '−'}{whole}<small className="text-[0.45em] text-gray-500">.{decimals}</small>
      {currency && <span className="font-mono text-sm tracking-wider text-gray-500 ml-1.5">{currency}</span>}
    </span>
  )
}

/**
 * The dashboard's hero: the month's surplus and how income splits, the transfer that's due
 * with its action, and a day-by-day line of the month's payments. All figures come from the
 * API; this only lays them out.
 */
export function MonthHero({
  budgetYearId, income, expenses, savings, surplus, incomeSplit, nextPending, transferPaymentMethod, transferDueDay, currentTransfer,
  myShare, onMarkPaid, baseCurrency, fmt,
}: MonthHeroProps) {
  const { data: payments, isLoading, isError } = useMonthPayments(budgetYearId)
  const short = surplus < 0

  const segments = incomeSplit
    ? [
        { key: 'expenses', label: 'Expenses', value: expenses, pct: incomeSplit.expensesPct, swatch: { background: ENTITY.expenses }, className: '' },
        { key: 'savings', label: 'Savings', value: savings, pct: incomeSplit.savingsPct, swatch: { background: ENTITY.savings }, className: '' },
        { key: 'surplus', label: 'Surplus', value: surplus, pct: incomeSplit.surplusPct, swatch: undefined, className: 'hatch-surplus' },
      ]
    : []
  // Only positive shares take room in the bar; flex-grow keeps them in proportion
  const barSegments = segments.filter((s) => parseFloat(s.pct) > 0)

  return (
    <div className="chart-frame">
      {payments && (
        <span aria-hidden="true" className="absolute -top-[7px] left-6 bg-gray-900 px-1.5 font-mono text-[10px] leading-none tracking-wider text-gray-500 py-0.5">
          {MONTH_SHORT[payments.month - 1].toUpperCase()} {payments.year}
        </span>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 border border-gray-800 bg-gray-900 p-4 @xl:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @3xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @3xl:gap-8">
          {/* Surplus and the income split */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-gray-400">Surplus per month</h2>
              {short && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/50 px-2 py-0.5 text-xs text-red-300">
                  <TriangleAlert size={12} aria-hidden="true" /> Over income
                </span>
              )}
            </div>
            <div className="mt-2">
              <Figure value={surplus} currency={baseCurrency} className={`text-5xl @3xl:text-6xl ${short ? 'text-red-400' : 'text-gray-100'}`} />
            </div>
            <p className="mt-2 text-sm text-gray-400">
              {!incomeSplit ? (
                <>Add income to see how it splits between expenses, savings and what's left.</>
              ) : short ? (
                <>Expenses and savings are <b className="font-semibold text-gray-100">{incomeSplit.surplusPct.replace('-', '')}%</b> more than the <b className="font-semibold text-gray-100">{fmt(income)}</b> income.</>
              ) : (
                <><b className="font-semibold text-gray-100">{incomeSplit.surplusPct}%</b> of <b className="font-semibold text-gray-100">{fmt(income)}</b> income is left after expenses and savings.</>
              )}
            </p>

            {barSegments.length > 0 && (
              <div className="mt-4 grid gap-2.5">
                <div
                  className="flex h-3.5 gap-0.5"
                  role="img"
                  aria-label={`Income split: ${segments.map((s) => `${s.label.toLowerCase()} ${s.pct}%`).join(', ')}`}
                >
                  {barSegments.map((s) => (
                    <div
                      key={s.key}
                      title={`${s.label} · ${fmt(s.value)} · ${s.pct}%`}
                      className={`h-full basis-0 first:rounded-l last:rounded-r ${s.className}`}
                      style={{ flexGrow: parseFloat(s.pct), ...s.swatch }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-gray-400">
                  {segments.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1.5">
                      <i className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${s.className}`} style={s.swatch} aria-hidden="true" />
                      {s.label}
                      <b className="font-semibold tabular-nums text-gray-100">{fmt(s.value, '')}</b>
                      <span className="text-xs text-gray-500">{s.pct}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* The transfer that's due */}
          <div className="grid content-start gap-2.5 border-t border-gray-800 pt-5 @3xl:border-l @3xl:border-t-0 @3xl:pl-8 @3xl:pt-0">
            {transferPaymentMethod === 'AUTOMATIC' && currentTransfer ? (
              <>
                <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-gray-400">
                  Transfer · {MONTH_SHORT[currentTransfer.month - 1]} {currentTransfer.year}
                </h2>
                <Figure value={parseFloat(currentTransfer.actualAmount ?? currentTransfer.calculatedAmount)} currency={baseCurrency} className="text-4xl text-gray-100" />
                <p className="text-sm text-gray-400">
                  {currentTransfer.status === 'PENDING' ? 'Goes' : 'Went'} into the budget account automatically on the{' '}
                  {ordinal(dueDayIn(transferDueDay, currentTransfer.year, currentTransfer.month))}
                  {myShare != null && <>; your share is <b className="font-semibold text-gray-100">{fmt(myShare)}</b></>}.
                </p>
              </>
            ) : transferPaymentMethod === 'MANUAL' && nextPending ? (
              <>
                <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-gray-400">
                  Transfer due · {dueDayIn(transferDueDay, nextPending.year, nextPending.month)} {MONTH_SHORT[nextPending.month - 1]} {nextPending.year}
                </h2>
                <Figure value={parseFloat(nextPending.calculatedAmount)} currency={baseCurrency} className="text-4xl text-amber-400" />
                <p className="text-sm text-gray-400">
                  Into the budget account
                  {myShare != null && <>; your share is <b className="font-semibold text-gray-100">{fmt(myShare)}</b></>}.
                </p>
                <div className="mt-1">
                  <button type="button" onClick={() => onMarkPaid(nextPending)} className={`inline-flex items-center gap-2 ${primaryBtn}`}>
                    <Check size={15} aria-hidden="true" /> Mark as paid
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-gray-400">Transfers</h2>
                <p className="inline-flex items-center gap-2 text-sm text-gray-300">
                  <Check size={16} className="text-green-400" aria-hidden="true" /> All transfers paid
                </p>
              </>
            )}
          </div>
        </div>

        {/* The month's payments, day by day */}
        <div className="border-t border-gray-800 pt-4">
          {payments ? (
            <PaymentsTimeline data={payments} fmt={fmt} />
          ) : isLoading ? (
            <p className="text-sm text-gray-500">Loading this month's payments…</p>
          ) : isError ? (
            <p className="text-sm text-gray-500">Couldn't load this month's payments.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
