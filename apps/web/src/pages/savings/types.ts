import type { AccountInfo, Category, CustomSplitInput, Ownership } from '../../api/types'
import type { Frequency } from '../../lib/constants'

/** GET /budget-years/:id/savings */
export interface SavingsEntry {
  id: string
  label: string
  amount: string
  frequency: Frequency
  monthlyEquivalent: string
  notes: string | null
  currencyCode: string | null
  originalAmount: string | null
  rateUsed: string | null
  ownership: Ownership
  ownedByUserId: string | null
  ownedBy: { id: string; name: string } | null
  categoryId: string | null
  category: Pick<Category, 'id' | 'name' | 'icon' | 'isSystemWide' | 'categoryType'> | null
  customSplits: { userId: string; user: { id: string; name: string }; pct: string }[]
  accountId: string | null
  account: AccountInfo | null
}

export interface EntryForm {
  label: string
  amount: string
  frequency: Frequency
  notes: string
  currencyCode: string
  ownership: Ownership
  ownedByUserId: string | null
  categoryId: string
  customSplits: CustomSplitInput[]
  accountId: string | null
}

export const emptyForm = (baseCurrency: string): EntryForm => ({
  label: '', amount: '', frequency: 'MONTHLY', notes: '', currencyCode: baseCurrency,
  ownership: 'SHARED', ownedByUserId: null, categoryId: '', customSplits: [], accountId: null,
})
