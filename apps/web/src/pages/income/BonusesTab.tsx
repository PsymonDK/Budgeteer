import { fmtDate } from './helpers'
import type { Bonus, Job } from './types'
import type { BonusEditor } from './useIncomeEditors'

interface BonusesTabProps {
  jobs: Job[]
  allJobsBonuses: Record<string, Bonus[]>
  fmt: (v: number | string) => string
  bonusEditor: BonusEditor
}

export function BonusesTab({ jobs, allJobsBonuses, fmt, bonusEditor }: BonusesTabProps) {
  const { openAddBonus, openEditBonus, setConfirmDeleteBonus } = bonusEditor
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold">Bonuses</h2>
        <p className="text-xs text-gray-500">Track one-off and spread-annually bonuses</p>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">Add a job first to track bonuses.</div>
      ) : (
        <div className="space-y-5">
          {jobs.map((job) => {
            const bonuses = allJobsBonuses[job.id] ?? []
            return (
              <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-white font-medium">{job.name}</h3>
                    {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                  </div>
                  <button onClick={() => openAddBonus(job.id)}
                    className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                    + Add bonus
                  </button>
                </div>

                {bonuses.length === 0 ? (
                  <p className="text-gray-600 text-sm">No bonuses for this job.</p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                        <th className="pb-2 pr-4">Label</th>
                        <th className="pb-2 pr-4">Payment date</th>
                        <th className="pb-2 pr-4">Net</th>
                        <th className="pb-2 pr-4">In budget</th>
                        <th className="pb-2 pr-4">Mode</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bonuses.map((b) => (
                        <tr key={b.id} className="border-b border-gray-800/50 last:border-0">
                          <td className="py-2 pr-4 text-white">{b.label}</td>
                          <td className="py-2 pr-4 text-gray-300">{fmtDate(b.paymentDate)}</td>
                          <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(b.netAmount)}</td>
                          <td className="py-2 pr-4">
                            {b.includeInBudget
                              ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Yes</span>
                              : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">No</span>
                            }
                          </td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {b.budgetMode === 'ONE_OFF' ? 'One-off' : b.budgetMode === 'SPREAD_ANNUALLY' ? 'Spread / year' : '—'}
                          </td>
                          <td className="py-2">
                            <div className="flex gap-3">
                              <button onClick={() => openEditBonus(b)}
                                className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                              <button onClick={() => setConfirmDeleteBonus({ jobId: job.id, bonusId: b.id })}
                                className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
