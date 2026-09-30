import type { Currency } from '../../api/types'
import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import type { BudgetMode, Job } from './types'
import type { BonusEditor } from './useIncomeEditors'
import { StickyActions } from '../../components/StickyActions'

interface BonusModalProps {
  editor: BonusEditor
  jobs: Job[]
  currencies: Currency[]
  baseCurrency: string
}

/** Add / edit bonus dialog. */
export function BonusModal({ editor, jobs, currencies, baseCurrency }: BonusModalProps) {
  const {
    bonusJobId, editingBonus, bonusForm, setBonusForm, bonusError,
    createBonusMutation, updateBonusMutation, closeBonus, handleBonusSubmit,
  } = editor
  return (
    <Modal title={editingBonus ? 'Edit bonus' : `Add bonus — ${jobs.find((j) => j.id === bonusJobId)?.name}`} onClose={closeBonus}>
      <form onSubmit={handleBonusSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
          <input type="text" value={bonusForm.label} onChange={(e) => setBonusForm({ ...bonusForm, label: e.target.value })}
            required autoFocus placeholder="e.g. Annual bonus" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 @xl:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Payment date</label>
            <input type="date" value={bonusForm.paymentDate} onChange={(e) => setBonusForm({ ...bonusForm, paymentDate: e.target.value })}
              required className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Gross amount</label>
            <input type="number" value={bonusForm.grossAmount} onChange={(e) => setBonusForm({ ...bonusForm, grossAmount: e.target.value })}
              required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Net amount</label>
            <input type="number" value={bonusForm.netAmount} onChange={(e) => setBonusForm({ ...bonusForm, netAmount: e.target.value })}
              required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
            <select value={bonusForm.currencyCode} onChange={(e) => setBonusForm({ ...bonusForm, currencyCode: e.target.value })}
              className={inputClass}>
              <option value={baseCurrency}>{baseCurrency}</option>
              {currencies.filter((c) => c.code !== baseCurrency).map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
        </div>
        {bonusForm.currencyCode && bonusForm.currencyCode !== baseCurrency && bonusForm.netAmount && (
          <p className="text-xs text-gray-500">
            ≈ {(parseFloat(bonusForm.netAmount) * (currencies.find((c) => c.code === bonusForm.currencyCode)?.rate ?? 1)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency} net
          </p>
        )}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bonusForm.includeInBudget} onChange={(e) => setBonusForm({ ...bonusForm, includeInBudget: e.target.checked })}
              className="rounded border-gray-600" />
            <span className="text-sm text-gray-300">Include in budget calculations</span>
          </label>
        </div>
        {bonusForm.includeInBudget && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Budget mode</label>
            <div className="flex gap-3">
              {(['ONE_OFF', 'SPREAD_ANNUALLY'] as BudgetMode[]).map((val) => {
                const label = val === 'ONE_OFF' ? 'One-off (appears in payment month)' : 'Spread annually (÷12 per month)'
                return (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" value={val} checked={bonusForm.budgetMode === val} onChange={() => setBonusForm({ ...bonusForm, budgetMode: val })}
                    className="border-gray-600" />
                  <span className="text-sm text-gray-300">{label}</span>
                </label>
                )
              })}
            </div>
          </div>
        )}
        <FormError message={bonusError} />
        <StickyActions>
          <button type="submit" disabled={createBonusMutation.isPending || updateBonusMutation.isPending}
            className={`flex-1 ${primaryBtn}`}>
            {createBonusMutation.isPending || updateBonusMutation.isPending ? 'Saving…' : editingBonus ? 'Save changes' : 'Add bonus'}
          </button>
          <button type="button" onClick={closeBonus}
            className={`flex-1 ${secondaryBtn}`}>Cancel</button>
        </StickyActions>
      </form>
    </Modal>
  )
}
