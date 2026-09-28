import { Link } from 'react-router-dom'
import type { BudgetYear } from '../../api/types'
import { StatusBadge } from '../../components/StatusBadge'
import { RETIRED_STATUS_CLASS_MUTED, statusLabel } from '../../lib/budgetYear'

interface RegularYearsTableProps {
  householdId: string | undefined
  years: BudgetYear[]
  isAdmin: boolean
  currentYear: number
  onCopy: (by: BudgetYear) => void
  onRetire: (by: BudgetYear) => void
  onPromote: (by: BudgetYear) => void
  onDelete: (by: BudgetYear) => void
}

/** Regular (non-simulation) budget years with status and admin actions. */
export function RegularYearsTable({ householdId, years: regularYears, isAdmin, currentYear, onCopy, onRetire, onPromote, onDelete }: RegularYearsTableProps) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Budget Years</h2>
      {regularYears.length === 0 ? (
        <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
          Your treasure chest is empty — no budget years yet.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Expenses</th>
                <th className="px-4 py-3 font-medium text-right">Savings</th>
                {isAdmin && <th className="px-4 py-3 sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {regularYears.map((by) => (
                <tr key={by.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium text-white">{by.year}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={by.status} retiredClass={RETIRED_STATUS_CLASS_MUTED}>
                      {by.status === 'SIMULATION' ? by.simulationName ?? 'Simulation' : statusLabel(by.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{by._count.expenses}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{by._count.savingsEntries}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to={`/households/${householdId}/expenses?budgetYearId=${by.id}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Expenses
                        </Link>
                        <Link
                          to={`/households/${householdId}/savings?budgetYearId=${by.id}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Savings
                        </Link>
                        <button
                          onClick={() => onCopy(by)}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Copy
                        </button>
                        {(by.status === 'ACTIVE' || by.status === 'FUTURE') && (
                          <button
                            onClick={() => onRetire(by)}
                            className="text-xs text-amber-600 hover:text-amber-400 transition-colors"
                          >
                            Retire
                          </button>
                        )}
                        {by.status === 'RETIRED' && by.year >= currentYear && (
                          <>
                            <button
                              onClick={() => onPromote(by)}
                              className="text-xs text-green-600 hover:text-green-400 transition-colors"
                            >
                              Restore
                            </button>
                            <button
                              onClick={() => onDelete(by)}
                              className="text-xs text-red-600 hover:text-red-400 transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  )
}

interface SimulationsTableProps {
  householdId: string | undefined
  simulations: BudgetYear[]
  canCreate: boolean
  onNewSimulation: () => void
  onRename: (by: BudgetYear) => void
  onPromote: (by: BudgetYear) => void
  onDelete: (by: BudgetYear) => void
}

/** Planning simulations with rename / promote / delete. */
export function SimulationsTable({ householdId, simulations, canCreate, onNewSimulation, onRename, onPromote, onDelete }: SimulationsTableProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Simulations</h2>
        {canCreate && (
          <button
            onClick={onNewSimulation}
            className="bg-purple-900/50 hover:bg-purple-800/60 text-purple-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            + New simulation
          </button>
        )}
      </div>
      {simulations.length === 0 ? (
        <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
          No simulations charted. Copy a budget year and choose "Simulation" to create one.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium text-right">Expenses</th>
                <th className="px-4 py-3 font-medium text-right">Savings</th>
                <th className="px-4 py-3 sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((by) => (
                <tr key={by.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                  <td className="px-4 py-3 text-white font-medium">
                    <span className="text-purple-300">{by.simulationName ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{by.year}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{by._count.expenses}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{by._count.savingsEntries}</td>
                  <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to={`/households/${householdId}/expenses?budgetYearId=${by.id}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Expenses
                        </Link>
                        <Link
                          to={`/households/${householdId}/savings?budgetYearId=${by.id}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Savings
                        </Link>
                        <button
                          onClick={() => onRename(by)}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => onPromote(by)}
                          className="text-xs text-green-600 hover:text-green-400 transition-colors"
                        >
                          Promote
                        </button>
                        <button
                          onClick={() => onDelete(by)}
                          className="text-xs text-red-600 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  )
}
