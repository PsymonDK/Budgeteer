import type { Frequency } from '../../lib/constants'
import type { Expense, ExpenseForm, SortKey } from './types'

const FREQ_ORDER: Record<Frequency, number> = {
  WEEKLY: 0, FORTNIGHTLY: 1, MONTHLY: 2, QUARTERLY: 3, BIANNUAL: 4, ANNUAL: 5,
}

export const MONTH_OPTIONS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

export const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthRangeLabel(startMonth: number | null, endMonth: number | null): string | null {
  if (startMonth == null && endMonth == null) return null
  const s = startMonth ?? 1
  const e = endMonth ?? 12
  if (s === 1 && e === 12) return null
  if (s === e) return MONTH_SHORT[s]
  return `${MONTH_SHORT[s]}–${MONTH_SHORT[e]}`
}

export const emptyForm = (baseCurrency: string): ExpenseForm => ({
  label: '', amount: '', frequency: 'MONTHLY', categoryId: '', frequencyPeriod: '',
  startMonth: '', endMonth: '', dueDay: '', notes: '',
  currencyCode: baseCurrency, ownership: 'SHARED', ownedByUserId: null, customSplits: [],
  accountId: null,
})

export function formFromExpense(expense: Expense, baseCurrency: string): ExpenseForm {
  return {
    label: expense.label,
    amount: expense.originalAmount ?? expense.amount,
    frequency: expense.frequency,
    categoryId: expense.category.id,
    frequencyPeriod: expense.frequencyPeriod ?? '',
    startMonth: expense.startMonth?.toString() ?? '',
    endMonth: expense.endMonth?.toString() ?? '',
    dueDay: expense.dueDay?.toString() ?? '',
    notes: expense.notes ?? '',
    currencyCode: expense.currencyCode ?? baseCurrency,
    ownership: expense.ownership ?? 'SHARED',
    ownedByUserId: expense.ownedByUserId ?? null,
    customSplits: expense.customSplits?.map((s) => ({ userId: s.userId, pct: s.pct })) ?? [],
    accountId: expense.account?.id ?? null,
  }
}

/** Filter by category/account chips, then sort by the chosen column. */
export function filterAndSortExpenses(
  expenses: Expense[], filterCategories: Set<string>, filterAccounts: Set<string>, sortKey: SortKey, sortAsc: boolean,
): Expense[] {
  let list = expenses
  if (filterCategories.size > 0) list = list.filter((e) => filterCategories.has(e.category.id))
  if (filterAccounts.size > 0) list = list.filter((e) => e.accountId != null && filterAccounts.has(e.accountId))

  return [...list].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'label':     cmp = a.label.localeCompare(b.label); break
      case 'category':  cmp = a.category.name.localeCompare(b.category.name); break
      case 'amount':    cmp = parseFloat(a.amount) - parseFloat(b.amount); break
      case 'frequency': cmp = FREQ_ORDER[a.frequency] - FREQ_ORDER[b.frequency]; break
      case 'monthly':   cmp = parseFloat(a.monthlyWhenActive) - parseFloat(b.monthlyWhenActive); break
    }
    return sortAsc ? cmp : -cmp
  })
}
