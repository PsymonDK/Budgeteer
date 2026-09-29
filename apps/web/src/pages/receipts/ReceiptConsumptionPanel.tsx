import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useReceiptSummary } from '../../api/queries'
import type { ReceiptSummaryPeriod } from '../../api/types'
import { PageLoader } from '../../components/LoadingSpinner'
import { useFmt } from '../../hooks/useFmt'
import { toLocalISODate, startOfLocalMonthISO } from '../../lib/dates'
import {
  CATEGORY_COLORS, RECEIPT_PERIOD_OPTIONS, compactInputClass, formatPercent, parseMoney, percentage, sameId,
} from './helpers'

/** Confirmed receipt spend for a chosen period, broken down by category and subcategory. */
export function ReceiptConsumptionPanel({ householdId }: { householdId: string }) {
  const fmt = useFmt()
  const [period, setPeriod] = useState<ReceiptSummaryPeriod>('currentMonth')
  const [startDate, setStartDate] = useState(() => startOfLocalMonthISO())
  const [endDate, setEndDate] = useState(() => toLocalISODate())
  const customRangeValid = period !== 'custom' || Boolean(startDate && endDate && startDate <= endDate)

  const { data: summary, isLoading, isFetching } = useReceiptSummary(householdId, period, startDate, endDate, {
    enabled: customRangeValid,
  })

  const total = parseMoney(summary?.total)
  const categoryRows = summary?.byCategory ?? []

  return (
    <section className="border border-gray-800 rounded-xl p-3 bg-gray-950/40">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Receipt consumption</h3>
          <p className="mt-1 text-xs text-gray-500">
            {summary ? `${summary.itemCount} confirmed line${summary.itemCount === 1 ? '' : 's'} · ${fmt(summary.total)}` : 'Confirmed receipt lines'}
            {isFetching && !isLoading ? <span className="text-amber-300"> · Updating</span> : null}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_auto_auto] gap-2">
          <label className="min-w-0">
            <span className="block text-xs font-medium text-gray-400 mb-1.5">Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as ReceiptSummaryPeriod)} className={compactInputClass}>
              {RECEIPT_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label className="min-w-0">
                <span className="block text-xs font-medium text-gray-400 mb-1.5">Start</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={compactInputClass} />
              </label>
              <label className="min-w-0">
                <span className="block text-xs font-medium text-gray-400 mb-1.5">End</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={compactInputClass} />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!customRangeValid ? (
          <div className="rounded-lg border border-amber-800/60 bg-amber-900/20 px-3 py-6 text-center text-sm text-amber-200">
            Choose a custom start date before or equal to the end date.
          </div>
        ) : isLoading ? (
          <div className="min-h-32"><PageLoader /></div>
        ) : !summary || total <= 0 || categoryRows.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-8 text-center text-sm text-gray-500">
            No confirmed receipt consumption for this period.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-4 overflow-hidden rounded-full bg-gray-800 flex" aria-label="Receipt spend by category">
              {categoryRows.map((category, index) => {
                const amount = parseMoney(category.total)
                const percent = percentage(amount, total)
                return (
                  <div
                    key={category.categoryId ?? 'uncategorized'}
                    className="h-full"
                    style={{ width: `${percent}%`, backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                    title={`${category.categoryName}: ${fmt(category.total)} (${formatPercent(percent)})`}
                  />
                )
              })}
            </div>

            <div className="space-y-3">
              {categoryRows.map((category, index) => {
                const categoryAmount = parseMoney(category.total)
                const categoryPercent = percentage(categoryAmount, total)
                const subcategoryRows = (summary.bySubcategory ?? [])
                  .filter((subcategory) => sameId(subcategory.categoryId, category.categoryId))
                  .sort((a, b) => parseMoney(b.total) - parseMoney(a.total))
                const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]

                return (
                  <div key={category.categoryId ?? 'uncategorized'} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="truncate text-sm font-medium text-gray-100">{category.categoryName}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800">
                          <div className="h-full rounded-full" style={{ width: `${categoryPercent}%`, backgroundColor: color }} />
                        </div>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm font-medium text-gray-100">{fmt(category.total)}</p>
                        <p className="text-xs text-gray-500">{formatPercent(categoryPercent)} · {category.itemCount} item{category.itemCount === 1 ? '' : 's'}</p>
                      </div>
                    </div>

                    {subcategoryRows.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {subcategoryRows.map((subcategory) => {
                          const subcategoryAmount = parseMoney(subcategory.total)
                          const totalPercent = percentage(subcategoryAmount, total)
                          const categoryShare = percentage(subcategoryAmount, categoryAmount)
                          return (
                            <div key={`${subcategory.categoryId ?? 'uncategorized'}-${subcategory.subcategoryId ?? 'none'}`} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                              <div className="min-w-0 pl-5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate text-xs text-gray-300">{subcategory.subcategoryName}</span>
                                  <span className="shrink-0 text-xs text-gray-500">{formatPercent(categoryShare)} of category</span>
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-800">
                                  <div className="h-full rounded-full bg-gray-500" style={{ width: `${categoryShare}%` }} />
                                </div>
                              </div>
                              <div className="pl-5 text-left md:pl-0 md:text-right">
                                <p className="text-xs font-medium text-gray-300">{fmt(subcategory.total)}</p>
                                <p className="text-xs text-gray-500">{formatPercent(totalPercent)} total</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {summary.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-800/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
                {summary.warnings.map((warning) => (
                  <p key={warning} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {warning}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
