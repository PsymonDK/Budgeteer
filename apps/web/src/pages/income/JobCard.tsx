import type { Household } from '../../api/types'
import { fmtDate } from './helpers'
import { TaxCardSection } from './TaxCardSection'
import { AllocationsEditor } from './AllocationsEditor'
import type { Job, TaxCardSettings } from './types'
import type { AllocationEditor, JobEditor, SalaryEditor, TaxCardEditor } from './useIncomeEditors'

interface JobCardProps {
  job: Job
  households: Household[]
  taxCards: Record<string, TaxCardSettings[]>
  fmt: (v: number | string) => string
  jobEditor: JobEditor
  salaryEditor: SalaryEditor
  taxCardEditor: TaxCardEditor
  allocations: AllocationEditor
}

/** One job on the Jobs & Salary tab: header, DK tax card settings and household allocations. */
export function JobCard({ job, households, taxCards, fmt, jobEditor, salaryEditor, taxCardEditor, allocations }: JobCardProps) {
  const {
    taxCardJobId, showTaxCardForm, taxCardForm, setTaxCardForm, taxCardError, editingTaxCardId,
    createTaxCardMutation, updateTaxCardMutation,
    toggleTaxCards, showNewTaxCardForm, editTaxCard, hideTaxCardForm, importTaxCardFromPayslip, handleTaxCardSubmit,
  } = taxCardEditor
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      {/* Job header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold text-base">{job.name}</h3>
            {job.isActive
              ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Active</span>
              : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">Ended</span>
            }
          </div>
          {job.employer && <p className="text-gray-400 text-sm mt-0.5">{job.employer}</p>}
          <p className="text-gray-500 text-xs mt-1">
            {fmtDate(job.startDate)}{job.endDate ? ` – ${fmtDate(job.endDate)}` : ' – present'}
          </p>
          {job.latestSalary && (
            <p className="text-amber-400 text-sm font-medium mt-1">
              Net {fmt(job.latestSalary.netAmount)} / month
              <span className="text-gray-500 text-xs font-normal ml-2">(gross {fmt(job.latestSalary.grossAmount)})</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => salaryEditor.openSalary(job.id)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Salary history</button>
          <button onClick={() => jobEditor.openEditJob(job)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
          {job.isActive && (
            <button onClick={() => jobEditor.setConfirmCloseJob(job)}
              className="text-xs text-red-500 hover:text-red-400 transition-colors">Close</button>
          )}
        </div>
      </div>

      {/* Tax card settings (DK only) */}
      {job.country === 'DK' && (
        <TaxCardSection
          jobId={job.id}
          cards={taxCards[job.id] ?? []}
          isExpanded={taxCardJobId === job.id}
          onToggle={() => toggleTaxCards(job.id)}
          showForm={taxCardJobId === job.id && showTaxCardForm}
          editingCardId={editingTaxCardId}
          onShowForm={showNewTaxCardForm}
          onEditCard={editTaxCard}
          onHideForm={hideTaxCardForm}
          onImportFromPayslip={() => importTaxCardFromPayslip(job.id)}
          form={taxCardForm}
          onFormChange={setTaxCardForm}
          onSubmit={handleTaxCardSubmit}
          isPending={createTaxCardMutation.isPending || updateTaxCardMutation.isPending}
          error={taxCardError}
          fmt={fmt}
        />
      )}

      {/* Allocations */}
      {households.length > 0 && (
        <AllocationsEditor job={job} households={households} allocations={allocations} fmt={fmt} />
      )}
    </div>
  )
}
