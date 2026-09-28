import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { qk } from '../api/queryKeys'

export interface AccountBreakdown {
  accountId: string | null
  accountName: string
  accountType: string | null
  monthlyAmount: number
}

export interface MemberBreakdown {
  userId: string
  name: string
  monthlyTotal: number
  byAccount: Omit<AccountBreakdown, 'accountType'>[]
}

export interface TransferBreakdown {
  byAccount: AccountBreakdown[]
  byMember: MemberBreakdown[]
}

export function useTransferBreakdown(budgetYearId: string | undefined) {
  return useQuery<TransferBreakdown>({
    queryKey: qk.transferBreakdown(budgetYearId),
    queryFn: async () => (await api.get<TransferBreakdown>(`/budget-years/${budgetYearId}/transfers/breakdown`)).data,
    enabled: !!budgetYearId,
  })
}
