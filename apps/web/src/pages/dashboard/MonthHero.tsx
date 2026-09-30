import { Check, TriangleAlert } from 'lucide-react'
import { SankeyChart, type SankeyLinkDef, type SankeyNodeDef } from '../../components/SankeyChart'
import type { BudgetTransfer } from '../../hooks/useTransfers'
import { ENTITY } from '../../lib/charts'
import { primaryBtn } from '../../lib/styles'
import type { DashboardSummary } from './types'

type Fmt = (v: number | string, suffix?: string) => string

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthHeroProps {
  /** The budget year's calendar year, for the frame label */
  year: number
  income: number
  expenses: number
  savings: number
  surplus: number
  incomeSplit: DashboardSummary['incomeSplit']
  /** Each member's income to categories, savings and surplus, from `buildIncomeSankey` */
  incomeFlow: { nodes: SankeyNodeDef[]; links: SankeyLinkDef[] } | null
  nextPending: BudgetTransfer | null
  /** The signed-in member's monthly share of the transfer, when the household splits it */
  myShare: number | null
  onMarkPaid: (t: BudgetTransfer) => void
  baseCurrency: string
  fmt: Fmt
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
 * with its action, and the income flow diagram. All figures come from the API; this only lays
 * them out.
 */
export function MonthHero({
  year, income, expenses, savings, surplus, incomeSplit, incomeFlow, nextPending, myShare, onMarkPaid, baseCurrency, fmt,
}: MonthHeroProps) {
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
      <span aria-hidden="true" className="absolute -top-[7px] left-6 bg-gray-900 px-1.5 font-mono text-[10px] leading-none tracking-wider text-gray-500 py-0.5">
        BUDGET {year}
      </span>
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
            {nextPending ? (
              <>
                <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-gray-400">
                  Transfer due · {MONTH_SHORT[nextPending.month - 1]} {nextPending.year}
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

        {/* VIZ-001: where each member's income goes */}
        {incomeFlow && incomeFlow.links.length > 0 && (
          <div className="border-t border-gray-800 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-100">Income flow</h3>
            <SankeyChart data={incomeFlow} currency={baseCurrency} />
          </div>
        )}
      </div>
    </div>
  )
}
