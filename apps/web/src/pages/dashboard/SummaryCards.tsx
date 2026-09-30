interface SummaryCardsProps {
  income: number
  expenses: number
  savings: number
  surplus: number
  savingsRate: number | null
  baseCurrency: string
}

const amount = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** DASH-001: income / expenses / savings / surplus per month. */
export function SummaryCards({ income, expenses, savings, surplus, savingsRate, baseCurrency }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="font-mono text-[11px] text-gray-400 uppercase tracking-widest mb-1">Income / mo</p>
        <p className="font-display text-3xl text-gray-100 tabular-nums">
          {amount(income)}
          <span className="font-mono text-xs tracking-wider text-gray-500 ml-1.5">{baseCurrency}</span>
        </p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="font-mono text-[11px] text-gray-400 uppercase tracking-widest mb-1">Expenses / mo</p>
        <p className="font-display text-3xl text-gray-100 tabular-nums">
          {amount(expenses)}
          <span className="font-mono text-xs tracking-wider text-gray-500 ml-1.5">{baseCurrency}</span>
        </p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="font-mono text-[11px] text-gray-400 uppercase tracking-widest mb-1">Savings / mo</p>
        <p className="font-display text-3xl text-gray-100 tabular-nums">
          {amount(savings)}
          <span className="font-mono text-xs tracking-wider text-gray-500 ml-1.5">{baseCurrency}</span>
        </p>
        {savingsRate !== null && (
          <p className="text-xs text-gray-500 mt-1">{savingsRate.toFixed(1)}% of income</p>
        )}
      </div>
      <div className={`bg-gray-900 border rounded-xl p-4 ${
        surplus < 0 ? 'border-red-800' : 'border-gray-800'
      }`}>
        <p className="font-mono text-[11px] text-gray-400 uppercase tracking-widest mb-1">Surplus / mo</p>
        <p className={`font-display text-3xl tabular-nums ${surplus < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {amount(surplus)}
          <span className="font-mono text-xs tracking-wider text-gray-500 ml-1.5">{baseCurrency}</span>
        </p>
      </div>
    </div>
  )
}
