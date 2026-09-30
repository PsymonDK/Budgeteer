import type { SavingsHistoryRow } from './types'

interface AffordabilityCalculatorProps {
  extraSavings: number
  setExtraSavings: (v: number) => void
  sliderMax: number
  adjustedSurplus: number
  savings: number
  income: number
  fmt: (v: number | string) => string
}

/** SAV-003: "what if I saved more each month?" slider (display-only what-if). */
export function AffordabilityCalculator({ extraSavings, setExtraSavings, sliderMax, adjustedSurplus, savings, income, fmt }: AffordabilityCalculatorProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">Affordability calculator</h2>
      <p className="text-gray-400 text-xs mb-4">What if I saved more each month?</p>
      <div className="flex items-center gap-4 mb-3">
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={10}
          value={extraSavings}
          onChange={(e) => setExtraSavings(Number(e.target.value))}
          className="flex-1 accent-amber-400"
        />
        <span className="text-amber-400 font-bold tabular-nums w-24 text-right">
          +{fmt(extraSavings)} / mo
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Remaining surplus</span>
        <span className={`font-bold tabular-nums text-lg ${adjustedSurplus < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {fmt(adjustedSurplus)} / mo
        </span>
      </div>
      {extraSavings > 0 && income > 0 && (
        <p className="text-xs text-gray-600 mt-2">
          Total savings rate would be {(((savings + extraSavings) / income) * 100).toFixed(1)}% of income
        </p>
      )}
      {extraSavings > 0 && (
        <button
          onClick={() => setExtraSavings(0)}
          className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  )
}

/** SAV-002: savings rate per budget year (shown when there are at least two years with a rate). */
export function SavingsRateHistory({ savingsHistory }: { savingsHistory: SavingsHistoryRow[] }) {
  if (savingsHistory.filter((r) => r.savingsRate !== null).length <= 1) return null
  return (
    <div className="flex flex-col">
      <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">Savings rate history</h2>
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
        {savingsHistory.filter((r) => r.savingsRate !== null).map((r) => {
          const rate = parseFloat(r.savingsRate!)
          return (
            <div key={r.year} className="flex items-center gap-3">
              <span className="text-gray-400 text-sm w-16 shrink-0">{r.year}</span>
              <div className="flex-1 bg-gray-800 rounded-full h-2">
                <div
                  className="bg-amber-400/70 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(rate, 100)}%` }}
                />
              </div>
              <span className="text-gray-300 text-sm tabular-nums w-12 text-right">{rate.toFixed(1)}%</span>
              <span className={`text-xs w-14 text-right ${
                r.status === 'ACTIVE' ? 'text-green-400' :
                r.status === 'FUTURE' ? 'text-blue-400' : 'text-gray-600'
              }`}>{r.status.toLowerCase()}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
