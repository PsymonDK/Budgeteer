import { SankeyChart, type SankeyLinkDef, type SankeyNodeDef } from '../../components/SankeyChart'
import type { ReceiptConsumptionSummary, ReceiptSummaryPeriod } from '../../api/types'

const inputSelectClass = 'bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400'

interface ReceiptFlowSectionProps {
  receiptSummary: ReceiptConsumptionSummary | undefined
  receiptSankeyData: { nodes: SankeyNodeDef[]; links: SankeyLinkDef[] } | null
  receiptPeriod: ReceiptSummaryPeriod
  setReceiptPeriod: (period: ReceiptSummaryPeriod) => void
  receiptStartDate: string
  setReceiptStartDate: (date: string) => void
  receiptEndDate: string
  setReceiptEndDate: (date: string) => void
  receiptCustomRangeValid: boolean
  baseCurrency: string
  fmt: (v: number | string) => string
}

/** Receipt consumption Sankey with its period picker. */
export function ReceiptFlowSection({
  receiptSummary, receiptSankeyData, receiptPeriod, setReceiptPeriod, receiptStartDate, setReceiptStartDate,
  receiptEndDate, setReceiptEndDate, receiptCustomRangeValid, baseCurrency, fmt,
}: ReceiptFlowSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 mb-3 @xl:flex-row @xl:items-end @xl:justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Receipt consumption flow</h2>
          <p className="text-xs text-gray-500 mt-1">
            {receiptSummary ? `${receiptSummary.itemCount} confirmed receipt lines · ${fmt(receiptSummary.total)}` : 'Confirmed receipt lines'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-400">
            <span className="block mb-1">Period</span>
            <select value={receiptPeriod} onChange={(e) => setReceiptPeriod(e.target.value as ReceiptSummaryPeriod)} className={`${inputSelectClass} min-w-[160px]`}>
              <option value="currentMonth">Current month</option>
              <option value="previousMonth">Previous month</option>
              <option value="currentYear">Current year</option>
              <option value="custom">Custom period</option>
            </select>
          </label>
          {receiptPeriod === 'custom' && (
            <>
              <label className="text-xs text-gray-400">
                <span className="block mb-1">Start</span>
                <input type="date" value={receiptStartDate} onChange={(e) => setReceiptStartDate(e.target.value)} className={inputSelectClass} />
              </label>
              <label className="text-xs text-gray-400">
                <span className="block mb-1">End</span>
                <input type="date" value={receiptEndDate} onChange={(e) => setReceiptEndDate(e.target.value)} className={inputSelectClass} />
              </label>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5">
        {receiptSankeyData ? (
          <SankeyChart data={receiptSankeyData} currency={receiptSummary?.baseCurrency ?? baseCurrency} height={360} />
        ) : receiptPeriod === 'custom' && !receiptCustomRangeValid ? (
          <div className="py-14 text-center text-sm text-amber-300">
            Choose a custom start date before or equal to the end date.
          </div>
        ) : (
          <div className="py-14 text-center text-sm text-gray-500">
            No confirmed receipt consumption for this period.
          </div>
        )}
        {receiptSummary?.warnings?.length ? (
          <div className="mt-4 space-y-1 text-xs text-amber-300">
            {receiptSummary.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
