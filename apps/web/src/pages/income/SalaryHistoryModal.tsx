import type { Currency } from '../../api/types'
import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { inputClass } from '../../lib/styles'
import { DeductionPanel } from './DeductionPanel'
import { fmtDate } from './helpers'
import type { Job } from './types'
import type { SalaryEditor } from './useIncomeEditors'

interface SalaryHistoryModalProps {
  editor: SalaryEditor
  jobs: Job[]
  currencies: Currency[]
  baseCurrency: string
  fmt: (v: number | string, suffix?: string) => string
}

/** Salary records for one job, with an add/edit form and the DK deduction preview. */
export function SalaryHistoryModal({ editor, jobs, currencies, baseCurrency, fmt }: SalaryHistoryModalProps) {
  const {
    salaryJobId, salaryForm, setSalaryForm, salaryError, editingSalary,
    salaryDeductionOverrides, setSalaryDeductionOverrides, salaryRecords,
    addSalaryMutation, updateSalaryMutation, deleteSalaryMutation,
    salaryJob, activeTaxCard, salaryLiveCalc,
    closeSalary, startEditSalary, cancelEditSalary, handleSalarySubmit,
  } = editor
  return (
    <Modal title={`Salary history — ${jobs.find((j) => j.id === salaryJobId)?.name}`} onClose={closeSalary} size="lg">
      {/* Existing records */}
      {salaryRecords.length > 0 && (
        <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
              <th className="pb-2 pr-4">Effective from</th>
              <th className="pb-2 pr-4">Gross / month</th>
              <th className="pb-2 pr-4">Net / month</th>
              <th className="pb-2 pr-4">Currency</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {salaryRecords.map((r) => (
              <tr key={r.id} className="border-b border-gray-800/50 last:border-0">
                <td className="py-2 pr-4 text-gray-300">{fmtDate(r.effectiveFrom)}</td>
                <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(r.grossAmount, '')}</td>
                <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(r.netAmount, '')}</td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{r.currencyCode ?? baseCurrency}</td>
                <td className="py-2 pl-4 text-right whitespace-nowrap">
                  <button
                    onClick={() => startEditSalary(r)}
                    className="text-xs text-gray-400 hover:text-white transition-colors mr-3"
                  >Edit</button>
                  <button
                    onClick={() => deleteSalaryMutation.mutate(r.id)}
                    disabled={deleteSalaryMutation.isPending}
                    className="text-xs text-red-500 hover:text-red-400 transition-colors"
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Add / Edit record */}
      <h3 className="text-sm font-medium text-gray-400 mb-3">{editingSalary ? 'Edit salary record' : 'Add salary record'}</h3>
      <form onSubmit={handleSalarySubmit} className="space-y-3">
        <div className={`grid gap-3 ${salaryJob?.country === 'DK' ? 'grid-cols-3' : 'grid-cols-4'}`}>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Effective from</label>
            <input type="date" value={salaryForm.effectiveFrom} onChange={(e) => setSalaryForm({ ...salaryForm, effectiveFrom: e.target.value })}
              required className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
            <input type="number" value={salaryForm.grossAmount} onChange={(e) => setSalaryForm({ ...salaryForm, grossAmount: e.target.value })}
              required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
          </div>
          {salaryJob?.country !== 'DK' && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
              <input type="number" value={salaryForm.netAmount} onChange={(e) => setSalaryForm({ ...salaryForm, netAmount: e.target.value })}
                required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
            <select value={salaryForm.currencyCode} onChange={(e) => setSalaryForm({ ...salaryForm, currencyCode: e.target.value })}
              className={inputClass}>
              <option value={baseCurrency}>{baseCurrency}</option>
              {currencies.filter((c) => c.code !== baseCurrency).map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
        </div>
        {salaryForm.currencyCode && salaryForm.currencyCode !== baseCurrency && salaryForm.netAmount && (
          <p className="text-xs text-gray-500">
            ≈ {(parseFloat(salaryForm.netAmount) * (currencies.find((c) => c.code === salaryForm.currencyCode)?.rate ?? 1)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency} / month net
          </p>
        )}

        {/* DK deduction breakdown panel */}
        {salaryJob?.country === 'DK' && (
          <DeductionPanel
            gross={parseFloat(salaryForm.grossAmount) || 0}
            liveCalc={salaryLiveCalc}
            overrides={salaryDeductionOverrides}
            onOverrideChange={(field, val) => setSalaryDeductionOverrides((prev) => ({ ...prev, [field]: val }))}
            hasTaxCard={!!activeTaxCard}
            baseCurrency={baseCurrency}
          />
        )}

        <FormError message={salaryError} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={addSalaryMutation.isPending || updateSalaryMutation.isPending}
            className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
            {addSalaryMutation.isPending || updateSalaryMutation.isPending ? 'Saving…' : editingSalary ? 'Save changes' : 'Add record'}
          </button>
          {editingSalary && (
            <button type="button" onClick={cancelEditSalary}
              className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          )}
        </div>
      </form>
    </Modal>
  )
}
