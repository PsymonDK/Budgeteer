import { MONTHS } from './helpers'
import type { Job, MonthlyOverride } from './types'
import type { OverrideEditor, PayslipImport } from './useIncomeEditors'

interface OverridesTabProps {
  jobs: Job[]
  allJobsOverrides: Record<string, MonthlyOverride[]>
  fmt: (v: number | string) => string
  overrideEditor: OverrideEditor
  payslipImport: PayslipImport
}

export function OverridesTab({ jobs, allJobsOverrides, fmt, overrideEditor, payslipImport }: OverridesTabProps) {
  const { openOverride, setConfirmDeleteOverride } = overrideEditor
  const { setPayslipImportJobId } = payslipImport
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold">Monthly Overrides</h2>
        <p className="text-xs text-gray-500">Override a specific month's salary for any job</p>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">Add a job first to create overrides.</div>
      ) : (
        <div className="space-y-5">
          {jobs.map((job) => {
            const overrides = allJobsOverrides[job.id] ?? []
            return (
              <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-white font-medium">{job.name}</h3>
                    {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setPayslipImportJobId(job.id) }}
                      className="text-xs text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                      Import payslip
                    </button>
                    <button onClick={() => openOverride(job.id)}
                      className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                      + Add override
                    </button>
                  </div>
                </div>

                {overrides.length === 0 ? (
                  <p className="text-gray-600 text-sm">No overrides for this job.</p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                        <th className="pb-2 pr-4">Month</th>
                        <th className="pb-2 pr-4">Gross</th>
                        <th className="pb-2 pr-4">Net</th>
                        <th className="pb-2 pr-4">Note</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrides.map((o) => (
                        <tr key={o.id} className="border-b border-gray-800/50 last:border-0">
                          <td className="py-2 pr-4 text-white">
                            <div className="flex items-center gap-2">
                              <span>{MONTHS[o.month - 1]} {o.year}</span>
                              {o.deductionsSource && (
                                <span className={`text-xs px-1.5 py-0.5 rounded border ${
                                  o.deductionsSource === 'PAYSLIP_IMPORT'
                                    ? 'bg-green-900/50 text-green-300 border-green-700'
                                    : 'bg-blue-900/50 text-blue-300 border-blue-700'
                                }`}>
                                  {o.deductionsSource === 'PAYSLIP_IMPORT' ? 'Payslip imported' : 'Payslip entered'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(o.grossAmount)}</td>
                          <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(o.netAmount)}</td>
                          <td className="py-2 pr-4 text-gray-500 text-xs">{o.note ?? '—'}</td>
                          <td className="py-2">
                            <button onClick={() => setConfirmDeleteOverride({ jobId: job.id, overrideId: o.id })}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
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
