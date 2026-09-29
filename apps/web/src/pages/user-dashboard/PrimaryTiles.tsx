import { Link } from 'react-router-dom'
import { PiggyBank, Briefcase, Receipt } from 'lucide-react'
import { Sparkline } from '../../components/Sparkline'
import type { PersonalDashboard } from './types'

interface PrimaryTilesProps {
  dashboard: PersonalDashboard | undefined
  showSparklines: boolean
  /** Formats a monthly amount scaled to the selected period. */
  pfmt: (v: number | string) => string
  periodLabel: string
}

/** Income / expenses / savings / surplus tiles of the personal dashboard. */
export function PrimaryTiles({ dashboard, showSparklines, pfmt, periodLabel }: PrimaryTilesProps) {
  return (
    <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">

      {/* Income tile */}
      <Link
        to="/income"
        className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors"
      >
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} className="text-amber-400" />
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Income</p>
        </div>
        <p className="text-2xl font-bold text-amber-400">{pfmt(dashboard?.income.grossMonthly ?? '0')}</p>
        <p className="text-xs text-gray-500 mt-0.5">Net: <span className="text-gray-300">{pfmt(dashboard?.income.netMonthly ?? '0')}</span></p>
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Allocated</span>
            <span className="text-gray-300">
              {pfmt(dashboard?.income.allocatedAmount ?? '0')}
              <span className="text-gray-600 ml-1">({parseFloat(dashboard?.income.allocatedPct ?? '0').toFixed(0)}%)</span>
            </span>
          </div>
          {parseFloat(dashboard?.income.unallocatedAmount ?? '0') > 0.005 && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Unallocated</span>
              <span className="text-amber-500">{pfmt(dashboard?.income.unallocatedAmount ?? '0')}</span>
            </div>
          )}
        </div>
        {showSparklines && dashboard && dashboard.income.sparkline.length >= 2 && (
          <div className="mt-4">
            <Sparkline data={dashboard.income.sparkline.map((s) => ({ value: s.gross }))} color="#f59e0b" />
          </div>
        )}
        <p className="text-xs text-gray-600 mt-2">{periodLabel}</p>
      </Link>

      {/* Expenses tile */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={14} className="text-red-400" />
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Expenses</p>
        </div>
        <p className="text-2xl font-bold text-red-400">{pfmt(dashboard?.expenses.total.monthlyEquivalent ?? '0')}</p>
        <p className="text-xs text-gray-600 mt-0.5">{periodLabel}</p>
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Personal</span>
            <span className="text-gray-300">{pfmt(dashboard?.expenses.personal.monthlyEquivalent ?? '0')}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Household share</span>
            <span className="text-gray-300">{pfmt(dashboard?.expenses.householdShare.monthlyEquivalent ?? '0')}</span>
          </div>
        </div>
        {showSparklines && dashboard && dashboard.expenses.householdShare.sparkline.length >= 2 && (
          <div className="mt-4">
            <Sparkline data={dashboard.expenses.householdShare.sparkline.map((s) => ({ value: s.amount }))} color="#ef4444" />
          </div>
        )}
      </div>

      {/* Savings tile */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <PiggyBank size={14} className="text-blue-400" />
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Savings</p>
        </div>
        <p className="text-2xl font-bold text-blue-400">{pfmt(dashboard?.savings.monthlyEquivalent ?? '0')}</p>
        <p className="text-xs text-gray-600 mt-0.5">{periodLabel}</p>
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">% of gross</span>
            <span className="text-gray-300">{parseFloat(dashboard?.savings.pctOfGross ?? '0').toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">% of net</span>
            <span className="text-gray-300">{parseFloat(dashboard?.savings.pctOfNet ?? '0').toFixed(1)}%</span>
          </div>
        </div>
        {showSparklines && dashboard && dashboard.savings.sparkline.length >= 2 && (
          <div className="mt-4">
            <Sparkline data={dashboard.savings.sparkline.map((s) => ({ value: s.amount }))} color="#3b82f6" />
          </div>
        )}
      </div>

      {/* Surplus tile */}
      {dashboard && (() => {
        const surplusAmt = parseFloat(dashboard.surplus.amount)
        const pos = dashboard.surplus.isPositive
        return (
          <div className={`rounded-xl border p-5 ${pos ? 'bg-emerald-950/30 border-emerald-900/50' : 'bg-red-950/30 border-red-900/50'}`}>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{pos ? 'Surplus' : 'Deficit'}</p>
            </div>
            <p className={`text-2xl font-bold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
              {!pos && '−'}{pfmt(Math.abs(surplusAmt).toFixed(2))}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">{periodLabel}</p>
            <p className="text-xs text-gray-500 mt-3">Net income − expenses − savings</p>
          </div>
        )
      })()}
    </div>
  )
}
