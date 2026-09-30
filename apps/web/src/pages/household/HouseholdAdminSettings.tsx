import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { BudgetModel, Household, PaymentMethod } from '../../api/types'
import { inputClass, segmentBtnSolid, segmentGroupPlain } from '../../lib/styles'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const BUDGET_MODEL_OPTIONS: { value: BudgetModel; label: string; description: string }[] = [
  { value: 'AVERAGE', label: 'Average', description: '1/12 of annual expenses each month. Simple and predictable.' },
  { value: 'FORWARD_LOOKING', label: 'Forward-looking', description: 'Recalculates each month based on what\'s left to cover for the rest of the year.' },
  { value: 'PAY_NO_PAY', label: 'Pay / No pay', description: 'Track each expense individually. Unpaid amounts roll over to the next month.' },
]

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/** Budget model, and how and when the monthly transfer is paid (household admins). */
export function TransferSettings({ householdId: id, household }: { householdId: string; household: Household }) {
  const queryClient = useQueryClient()

  const updateSettingsMutation = useMutation({
    mutationFn: (settings: { transferPaymentMethod?: PaymentMethod; transferDueDay?: number; budgetModel?: BudgetModel }) =>
      api.put(`/households/${id}`, { name: household!.name, ...settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
      // Switching to automatic marks due transfers paid; the dashboard and to-pay list change
      queryClient.invalidateQueries({ queryKey: qk.transfersAll() })
      queryClient.invalidateQueries({ queryKey: ['occurrences'] })
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
    },
    onError: () => toast.error('Failed to update settings'),
  })

  return (
    <div className="mt-8 border border-gray-800 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Transfer settings</h2>

      {/* Budget model selector */}
      <div className="mb-6">
        <p className="text-sm font-medium text-white mb-3">Budget model</p>
        <div className="space-y-2">
          {BUDGET_MODEL_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateSettingsMutation.mutate({ budgetModel: option.value })}
              disabled={updateSettingsMutation.isPending || household.budgetModel === option.value}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors disabled:cursor-default ${
                household.budgetModel === option.value
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-gray-700 hover:border-gray-600 bg-gray-800/50 disabled:opacity-50'
              }`}
            >
              <p className={`text-sm font-medium ${household.budgetModel === option.value ? 'text-amber-400' : 'text-white'}`}>
                {option.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* How and when the transfer is paid */}
      <div className="pt-4 border-t border-gray-800 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <p id="transfer-method-label" className="text-sm font-medium text-white mb-2">How the transfer is paid</p>
          <div role="radiogroup" aria-labelledby="transfer-method-label" className={segmentGroupPlain}>
            {(['AUTOMATIC', 'MANUAL'] as const).map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={household.transferPaymentMethod === method}
                onClick={() => updateSettingsMutation.mutate({ transferPaymentMethod: method })}
                disabled={updateSettingsMutation.isPending || household.transferPaymentMethod === method}
                className={segmentBtnSolid(household.transferPaymentMethod === method)}
              >
                {method === 'AUTOMATIC' ? 'Automatic' : 'Manual'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            {household.transferPaymentMethod === 'AUTOMATIC'
              ? "A standing order: each month's transfer is marked paid at the planned amount on its due day."
              : "You make the transfer yourself: it's on the dashboard's to-pay list until you tick it off."}
          </p>
        </div>
        <div>
          <label htmlFor="transfer-due-day" className="block text-sm font-medium text-white mb-2">Due day</label>
          <select
            id="transfer-due-day"
            value={household.transferDueDay}
            onChange={(e) => updateSettingsMutation.mutate({ transferDueDay: Number(e.target.value) })}
            disabled={updateSettingsMutation.isPending}
            className={`${inputClass} w-28`}
          >
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <p className="text-xs text-gray-500 mt-1.5">Days past a month's end fall on its last day.</p>
        </div>
      </div>
    </div>
  )
}

/** Deactivate / reactivate the household (household admins). */
export function DangerZone({ householdId: id, household }: { householdId: string; household: Household }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const deactivateMutation = useMutation({
    mutationFn: () => api.put(`/households/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.households() })
      toast.success('Household deactivated')
      navigate('/')
    },
    onError: () => toast.error('Failed to deactivate household'),
  })

  const reactivateMutation = useMutation({
    mutationFn: () => api.put(`/households/${id}/reactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
      queryClient.invalidateQueries({ queryKey: qk.households() })
      toast.success('Household reactivated')
    },
    onError: () => toast.error('Failed to reactivate household'),
  })

  return (
    <div className="mt-12 border border-red-900/50 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-1">Danger zone</h2>
      {household.isActive ? (
        <>
          <p className="text-gray-400 text-sm mb-4">
            Deactivating this household hides it from the dashboard. All data is preserved and it can be reactivated at any time.
          </p>
          <button
            onClick={() => setConfirmDeactivate(true)}
            className="bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Deactivate household
          </button>
        </>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-4">This household is deactivated and hidden from the dashboard.</p>
          <button
            onClick={() => reactivateMutation.mutate()}
            disabled={reactivateMutation.isPending}
            className="bg-green-950 hover:bg-green-900 border border-green-800 text-green-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {reactivateMutation.isPending ? 'Reactivating…' : 'Reactivate household'}
          </button>
        </>
      )}

      {/* Confirm deactivate */}
      {confirmDeactivate && (
        <ConfirmDialog
          title="Deactivate household"
          onClose={() => setConfirmDeactivate(false)}
          onConfirm={() => { deactivateMutation.mutate(); setConfirmDeactivate(false) }}
          pending={deactivateMutation.isPending}
          confirmLabel="Deactivate"
        >
          <p className="text-gray-300 text-sm mb-6">
            This will hide <span className="font-semibold text-white">{household.name}</span> from the dashboard. All data is preserved and the household can be reactivated from the settings page.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
