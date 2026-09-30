import type { AccountInfo, Category, CustomSplitInput, Ownership } from '../../api/types'
import type { Frequency } from '../../lib/constants'

/** GET /budget-years/:id/savings */
export interface SavingsEntry {
  id: string
  label: string
  amount: string
  frequency: Frequency
  monthlyEquivalent: string
  /** Day of the month it's paid (1–31); null = no set day */
  dueDay: number | null
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
  /** '' = no set day */
  dueDay: string
  notes: string
  currencyCode: string
  ownership: Ownership
  ownedByUserId: string | null
  categoryId: string
  customSplits: CustomSplitInput[]
  accountId: string | null
}

export const emptyForm = (baseCurrency: string): EntryForm => ({
  label: '', amount: '', frequency: 'MONTHLY', dueDay: '', notes: '', currencyCode: baseCurrency,
  ownership: 'SHARED', ownedByUserId: null, categoryId: '', customSplits: [], accountId: null,
})
