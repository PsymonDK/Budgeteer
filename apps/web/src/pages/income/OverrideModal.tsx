import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { DeductionPanel } from './DeductionPanel'
import { MONTHS } from './helpers'
import type { Job } from './types'
import type { OverrideEditor } from './useIncomeEditors'
import { StickyActions } from '../../components/StickyActions'

/** Add a monthly salary override for one job (with the DK deduction preview). */
export function OverrideModal({ editor, jobs, baseCurrency }: { editor: OverrideEditor; jobs: Job[]; baseCurrency: string }) {
  const {
    overrideJobId, overrideForm, setOverrideForm, overrideError,
    overrideDeductionOpen, setOverrideDeductionOpen, overrideDeductionOverrides, setOverrideDeductionOverrides,
    upsertOverrideMutation, overrideJob, overrideActiveTaxCard, overrideLiveCalc,
    closeOverride, handleOverrideSubmit,
  } = editor
  return (
    <Modal title={`Add monthly override — ${jobs.find((j) => j.id === overrideJobId)?.name}`} onClose={closeOverride}>
      <form onSubmit={handleOverrideSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
            <input type="number" value={overrideForm.year} onChange={(e) => setOverrideForm({ ...overrideForm, year: e.target.value })}
              required min="2000" max="2100" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
            <select value={overrideForm.month} onChange={(e) => setOverrideForm({ ...overrideForm, month: e.target.value })} className={inputClass}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className={`grid gap-4 ${overrideJob?.country === 'DK' ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className={overrideJob?.country === 'DK' ? 'grid grid-cols-2 gap-4' : ''}>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
              <input type="number" value={overrideForm.grossAmount} onChange={(e) => setOverrideForm({ ...overrideForm, grossAmount: e.target.value })}
                required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
            {overrideJob?.country !== 'DK' && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
                <input type="number" value={overrideForm.netAmount} onChange={(e) => setOverrideForm({ ...overrideForm, netAmount: e.target.value })}
                  required={overrideJob?.country !== 'DK'} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Note <span className="text-gray-600">(optional)</span></label>
          <input type="text" value={overrideForm.note} onChange={(e) => setOverrideForm({ ...overrideForm, note: e.target.value })}
            placeholder="e.g. Sick leave, parental leave" className={inputClass} />
        </div>

        {/* Deduction breakdown for DK jobs */}
        {overrideJob?.country === 'DK' && (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <button type="button" onClick={() => setOverrideDeductionOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              <span>Deduction breakdown</span>
              <span className="text-xs">{overrideDeductionOpen ? '▲' : '▼'}</span>
            </button>
            {overrideDeductionOpen && (
              <div className="p-4 border-t border-gray-700">
                <DeductionPanel
                  gross={parseFloat(overrideForm.grossAmount) || 0}
                  liveCalc={overrideLiveCalc}
                  overrides={overrideDeductionOverrides}
                  onOverrideChange={(field, val) => setOverrideDeductionOverrides((prev) => ({ ...prev, [field]: val }))}
                  hasTaxCard={!!overrideActiveTaxCard}
                  baseCurrency={baseCurrency}
                />
              </div>
            )}
          </div>
        )}

        <FormError message={overrideError} />
        <StickyActions>
          <button type="submit" disabled={upsertOverrideMutation.isPending}
            className={`flex-1 ${primaryBtn}`}>
            {upsertOverrideMutation.isPending ? 'Saving…' : 'Save override'}
          </button>
          <button type="button" onClick={closeOverride}
            className={`flex-1 ${secondaryBtn}`}>Cancel</button>
        </StickyActions>
      </form>
    </Modal>
  )
}
