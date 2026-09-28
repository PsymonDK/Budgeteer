import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../api/client'
import { qk } from '../api/queryKeys'
import { getApiError } from '../lib/apiError'

// Deleting expenses, savings and income records moves them to a trash (they are
// never erased). These hooks list trashed items and restore them.

export interface TrashUser { id: string; name: string | null }

/** GET /households/:id/trash */
export interface HouseholdTrashItem {
  kind: 'expense' | 'savings'
  id: string
  label: string
  categoryName: string | null
  amount: string
  currencyCode: string | null
  frequency: string
  monthlyEquivalent: string
  budgetYear: { id: string; year: number; status: string; simulationName: string | null }
  deletedAt: string
  deletedBy: TrashUser | null
  canRestore: boolean
}

/** GET /users/:id/income/trash */
export interface IncomeTrashItem {
  kind: 'salary' | 'override' | 'bonus' | 'taxcard'
  id: string
  label: string
  job: { id: string; name: string }
  grossAmount: string | null
  netAmount: string | null
  currencyCode: string | null
  deletedAt: string
  deletedBy: TrashUser | null
}

export function useHouseholdTrash(householdId: string | undefined) {
  return useQuery<HouseholdTrashItem[]>({
    queryKey: qk.householdTrash(householdId),
    queryFn: async () => (await api.get<HouseholdTrashItem[]>(`/households/${householdId}/trash`)).data,
    enabled: !!householdId,
  })
}

export function useIncomeTrash(userId: string | undefined) {
  return useQuery<IncomeTrashItem[]>({
    queryKey: qk.incomeTrash(userId),
    queryFn: async () => (await api.get<IncomeTrashItem[]>(`/users/${userId}/income/trash`)).data,
    enabled: !!userId,
  })
}

/** Restore URL for an item in the household or income trash. */
export function restoreUrl(scope: { householdId: string } | { userId: string }, kind: string, id: string): string {
  return 'householdId' in scope
    ? `/households/${scope.householdId}/trash/${kind}/${id}/restore`
    : `/users/${scope.userId}/income/trash/${kind}/${id}/restore`
}

/**
 * Restores a trashed item. A restore can affect almost any figure (totals,
 * transfers, income, counts), so every query is refreshed afterwards.
 */
export function useRestoreFromTrash() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => api.post(url),
    onSuccess: () => {
      queryClient.invalidateQueries()
      toast.success('Restored')
    },
    onError: (err) => toast.error(getApiError(err, 'Failed to restore')),
  })
}

/**
 * Toast shown after a delete, with an Undo action that restores the item. Returns
 * a function to call from the delete mutation's onSuccess.
 */
export function useTrashedToast() {
  const restore = useRestoreFromTrash()
  return (message: string, url: string) =>
    toast.success(message, {
      description: 'Moved to trash',
      action: { label: 'Undo', onClick: () => restore.mutate(url) },
    })
}
