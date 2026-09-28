import type { AccountInfo, Category, CustomSplitInput, Ownership } from '../../api/types'
import type { Frequency } from '../../lib/constants'

/** GET /budget-years/:id/expenses */
export interface Expense {
  id: string
  label: string
  amount: string
  frequency: Frequency
  frequencyPeriod: string | null
  startMonth: number | null
  endMonth: number | null
  monthlyEquivalent: string
  monthlyWhenActive: string
  amountInBase: string
  notes: string | null
  category: Pick<Category, 'id' | 'name' | 'icon' | 'isSystemWide' | 'categoryType'>
  currencyCode: string | null
  originalAmount: string | null
  rateUsed: string | null
  ownership: Ownership
  ownedByUserId: string | null
  ownedBy: { id: string; name: string } | null
  customSplits: { userId: string; user: { id: string; name: string }; pct: string }[]
  accountId: string | null
  account: AccountInfo | null
}

export type SortKey = 'label' | 'category' | 'amount' | 'frequency' | 'monthly'

export interface ExpenseForm {
  label: string
  amount: string
  frequency: Frequency
  categoryId: string
  frequencyPeriod: string
  startMonth: string
  endMonth: string
  notes: string
  currencyCode: string
  ownership: Ownership
  ownedByUserId: string | null
  customSplits: CustomSplitInput[]
  accountId: string | null
}
