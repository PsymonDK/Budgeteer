import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { BudgetModel, Household } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const BUDGET_MODEL_OPTIONS: { value: BudgetModel; label: string; description: string }[] = [
  { value: 'AVERAGE', label: 'Average', description: '1/12 of annual expenses each month. Simple and predictable.' },
  { value: 'FORWARD_LOOKING', label: 'Forward-looking', description: 'Recalculates each month based on what\'s left to cover for the rest of the year.' },
  { value: 'PAY_NO_PAY', label: 'Pay / No pay', description: 'Track each expense individually. Unpaid amounts roll over to the next month.' },
]

/** Budget model + auto-mark-as-paid settings (household admins). */
export function TransferSettings({ householdId: id, household }: { householdId: string; household: Household }) {
  const queryClient = useQueryClient()

  const updateSettingsMutation = useMutation({
    mutationFn: (settings: { autoMarkTransferPaid?: boolean; budgetModel?: BudgetModel }) =>
      api.put(`/households/${id}`, { name: household!.name, ...settings }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.household(id) }),
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

      {/* Auto-mark toggle */}
      <div className="flex items-start justify-between gap-4 pt-4 border-t border-gray-800">
        <div>
          <p className="text-sm font-medium text-white">Auto-mark transfer as paid</p>
          <p className="text-xs text-gray-500 mt-0.5">
            On the 1st of each month the previous month's transfer is automatically marked as paid at the planned amount.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={household.autoMarkTransferPaid}
          onClick={() => updateSettingsMutation.mutate({ autoMarkTransferPaid: !household.autoMarkTransferPaid })}
          disabled={updateSettingsMutation.isPending}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
            household.autoMarkTransferPaid ? 'bg-amber-500' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              household.autoMarkTransferPaid ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
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
