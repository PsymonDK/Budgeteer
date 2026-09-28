import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import type { JobEditor } from './useIncomeEditors'

/** Add / edit job dialog. */
export function JobModal({ editor }: { editor: JobEditor }) {
  const { editingJob, jobForm, setJobForm, jobFormError, createJobMutation, updateJobMutation, closeJobModal, handleJobSubmit } = editor
  return (
    <Modal title={editingJob ? 'Edit job' : 'Add job'} onClose={closeJobModal}>
      <form onSubmit={handleJobSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Job title</label>
          <input type="text" value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
            required autoFocus placeholder="e.g. Software Engineer" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Employer <span className="text-gray-600">(optional)</span></label>
          <input type="text" value={jobForm.employer} onChange={(e) => setJobForm({ ...jobForm, employer: e.target.value })}
            placeholder="e.g. Acme Corp" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Country</label>
          <select value={jobForm.country} onChange={(e) => setJobForm({ ...jobForm, country: e.target.value })} className={inputClass}>
            <option value="DK">DK — Denmark</option>
            <option value="OTHER">Other (generic)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Start date</label>
            <input type="date" value={jobForm.startDate} onChange={(e) => setJobForm({ ...jobForm, startDate: e.target.value })}
              required className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">End date <span className="text-gray-600">(optional)</span></label>
            <input type="date" value={jobForm.endDate} onChange={(e) => setJobForm({ ...jobForm, endDate: e.target.value })}
              className={inputClass} />
          </div>
        </div>
        <FormError message={jobFormError} />
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={createJobMutation.isPending || updateJobMutation.isPending}
            className={`flex-1 ${primaryBtn}`}>
            {createJobMutation.isPending || updateJobMutation.isPending ? 'Saving…' : editingJob ? 'Save changes' : 'Add job'}
          </button>
          <button type="button" onClick={closeJobModal}
            className={`flex-1 ${secondaryBtn}`}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}
