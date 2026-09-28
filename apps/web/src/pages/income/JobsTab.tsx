import type { Household } from '../../api/types'
import { PageLoader } from '../../components/LoadingSpinner'
import { primaryBtnSm } from '../../lib/styles'
import { JobCard } from './JobCard'
import type { Job, TaxCardSettings } from './types'
import type { AllocationEditor, JobEditor, SalaryEditor, TaxCardEditor } from './useIncomeEditors'

interface JobsTabProps {
  jobs: Job[]
  isLoading: boolean
  households: Household[]
  taxCards: Record<string, TaxCardSettings[]>
  fmt: (v: number | string) => string
  jobEditor: JobEditor
  salaryEditor: SalaryEditor
  taxCardEditor: TaxCardEditor
  allocations: AllocationEditor
}

export function JobsTab({ jobs, isLoading, households, taxCards, fmt, jobEditor, salaryEditor, taxCardEditor, allocations }: JobsTabProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold">Jobs & Salary</h2>
        <button onClick={jobEditor.openAddJob}
          className={primaryBtnSm}>
          + Add job
        </button>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No work on the horizon yet</p>
          <p className="text-sm">Add a job to start tracking your salary history.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              households={households}
              taxCards={taxCards}
              fmt={fmt}
              jobEditor={jobEditor}
              salaryEditor={salaryEditor}
              taxCardEditor={taxCardEditor}
              allocations={allocations}
            />
          ))}
        </div>
      )}
    </div>
  )
}
