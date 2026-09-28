import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { qk } from '../api/queryKeys'

export interface BudgetTransfer {
  id: string
  budgetYearId: string
  year: number
  month: number
  calculatedAmount: string
  actualAmount: string | null
  status: 'PENDING' | 'PAID' | 'ADJUSTED'
  calculatedAt: string
  paidAt: string | null
  automationRunId: string | null
}

export function useTransfers(budgetYearId: string | undefined) {
  return useQuery<BudgetTransfer[]>({
    queryKey: qk.transfers(budgetYearId),
    queryFn: async () => (await api.get<BudgetTransfer[]>(`/budget-years/${budgetYearId}/transfers`)).data,
    enabled: !!budgetYearId,
  })
}
