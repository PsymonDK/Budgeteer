import { ArrowRight, AlertTriangle } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import type { HouseholdSummary } from './types'

// ── Sub-components ────────────────────────────────────────────────────────────

export function HouseholdCard({ household: h, onClick, fmt, periodLabel }: { household: HouseholdSummary; onClick: () => void; fmt: (v: number | string) => string; periodLabel: string }) {
  const surplus = parseFloat(h.monthlySurplus)
  const surplusColor = surplus >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <button
      onClick={onClick}
      className="w-full bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 text-left transition-colors group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="text-base font-semibold text-white truncate">{h.name}</h3>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              h.myRole === 'ADMIN' ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-800 text-gray-400'
            }`}>
              {h.myRole === 'ADMIN' ? 'Admin' : 'Member'}
            </span>
            {h.budgetYear && (
              <StatusBadge status={h.budgetYear.status} shape="pill">
                {h.budgetYear.year} · {h.budgetYear.status}
              </StatusBadge>
            )}
            {!h.budgetYear && <span className="text-xs text-gray-600">No active budget</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5">
            <Stat label={`Income ${periodLabel}`} value={h.monthlyGrossIncome} subLabel="Net" subValue={h.monthlyIncome} color="text-gray-200" fmt={fmt} />
            <Stat label={`Expenses ${periodLabel}`} value={h.monthlyExpenses} color="text-gray-200" fmt={fmt} />
            <Stat label={`Savings ${periodLabel}`} value={h.monthlySavings} color="text-gray-200" fmt={fmt} />
            <Stat label={`Surplus ${periodLabel}`} value={h.monthlySurplus} color={surplusColor} fmt={fmt} />
          </div>
          {(h.warnings.expensesExceedIncome || h.warnings.noSavings) && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {h.warnings.expensesExceedIncome && (
                <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-full px-2 py-0.5">
                  <AlertTriangle size={10} /> Expenses exceed income
                </span>
              )}
              {h.warnings.noSavings && (
                <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800/50 border border-gray-700/30 rounded-full px-2 py-0.5">
                  <AlertTriangle size={10} /> No savings
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ArrowRight size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors mt-1" />
          <span className="text-xs text-gray-500">{h.memberCount} {h.memberCount === 1 ? 'member' : 'members'}</span>
        </div>
      </div>
    </button>
  )
}

function Stat({ label, value, subLabel, subValue, color, fmt }: {
  label: string; value: string; subLabel?: string; subValue?: string; color: string; fmt: (v: number | string) => string
}) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${color}`}>{fmt(value)}</p>
      {subLabel && subValue !== undefined && (
        <p className="text-xs text-gray-600">{subLabel}: {fmt(subValue)}</p>
      )}
    </div>
  )
}
