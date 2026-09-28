import { useState, useMemo, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { CategoryIcon } from '../components/CategoryIcon'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { CategoryFilter } from '../components/CategoryFilter'
import { BudgetYearSelector } from '../components/BudgetYearSelector'
import { AccountSelect } from '../components/AccountSelect'
import { OwnershipFields, customSplitTotal } from '../components/OwnershipFields'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FormError } from '../components/FormError'
import { inputClass, primaryBtn, secondaryBtn, primaryBtnSm, segmentGroup, segmentBtn } from '../lib/styles'
import { FREQUENCIES, type Frequency, ACCOUNT_TYPE_LABELS, calcMonthly } from '../lib/constants'
import { useFmt, useBaseCurrency } from '../hooks/useFmt'
import { getApiError } from '../lib/apiError'
import type { AccountInfo, BudgetYear, Category, CustomSplitInput, Ownership } from '../api/types'
import { qk } from '../api/queryKeys'
import {
  useBudgetYearAccounts, useBudgetYears, useCategories, useCurrencies, useHouseholdDetail,
} from '../api/queries'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Expense {
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

type SortKey = 'label' | 'category' | 'amount' | 'frequency' | 'monthly'

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQ_ORDER: Record<Frequency, number> = {
  WEEKLY: 0, FORTNIGHTLY: 1, MONTHLY: 2, QUARTERLY: 3, BIANNUAL: 4, ANNUAL: 5,
}

// ── Expense form state ────────────────────────────────────────────────────────

interface ExpenseForm {
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

const MONTH_OPTIONS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthRangeLabel(startMonth: number | null, endMonth: number | null): string | null {
  if (startMonth == null && endMonth == null) return null
  const s = startMonth ?? 1
  const e = endMonth ?? 12
  if (s === 1 && e === 12) return null
  if (s === e) return MONTH_SHORT[s]
  return `${MONTH_SHORT[s]}–${MONTH_SHORT[e]}`
}

const emptyForm = (baseCurrency: string): ExpenseForm => ({
  label: '', amount: '', frequency: 'MONTHLY', categoryId: '', frequencyPeriod: '',
  startMonth: '', endMonth: '', notes: '',
  currencyCode: baseCurrency, ownership: 'SHARED', ownedByUserId: null, customSplits: [],
  accountId: null,
})

// ── Component ─────────────────────────────────────────────────────────────────

export function ExpensesPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [searchParams] = useSearchParams()
  const requestedYearId = searchParams.get('budgetYearId')
  const queryClient = useQueryClient()

  // Sort / filter / view state
  const [sortKey, setSortKey] = useState<SortKey>('category')
  const [sortAsc, setSortAsc] = useState(true)
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set())
  const [filterAccounts, setFilterAccounts] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'list' | 'calendar'>('list')

  // Modal state
  const [showAdd, setShowAdd] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyForm('DKK'))
  const [formError, setFormError] = useState('')

  // Bulk edit state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState<{ categoryId: string; accountId: string }>({ categoryId: '', accountId: '' })
  const [bulkError, setBulkError] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: budgetYears = [], isLoading: yearsLoading } = useBudgetYears(householdId)

  // Respect ?budgetYearId param; otherwise default to active year or most recent
  const [selectedYearId, setSelectedYearId] = useState<string | null>(requestedYearId)
  const activeBudgetYear = (
    selectedYearId
      ? budgetYears.find((y) => y.id === selectedYearId)
      : budgetYears.find((y) => y.status === 'ACTIVE') ?? budgetYears[0]
  ) ?? null
  const isReadOnly = activeBudgetYear?.status === 'RETIRED'

  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: qk.expenses(activeBudgetYear?.id),
    queryFn: async () =>
      (await api.get<Expense[]>(`/budget-years/${activeBudgetYear!.id}/expenses`)).data,
    enabled: !!activeBudgetYear,
  })

  const { data: categories = [] } = useCategories(householdId, 'EXPENSE')

  const { data: currencies = [] } = useCurrencies()

  const { data: householdData } = useHouseholdDetail(householdId)
  const members = householdData?.members ?? []

  const { data: accountGroups } = useBudgetYearAccounts(activeBudgetYear?.id)
  const personalAccounts = accountGroups?.personal ?? []
  const householdAccountOptions = accountGroups?.household ?? []
  const hasAccounts = personalAccounts.length > 0 || householdAccountOptions.length > 0

  // ── Derived data ─────────────────────────────────────────────────────────────

  const accountsInExpenses = useMemo(() => {
    const map = new Map<string, AccountInfo>()
    for (const e of expenses) {
      if (e.account) map.set(e.account.id, e.account)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [expenses])

  const filtered = useMemo(() => {
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
  }, [expenses, filterAccounts, filterCategories, sortKey, sortAsc])

  const totalMonthly = useMemo(
    () => filtered.reduce((sum, e) => sum + parseFloat(e.monthlyWhenActive), 0),
    [filtered]
  )

  const selectedCurrencyRate = currencies.find((c) => c.code === form.currencyCode)?.rate ?? 1
  const previewMonthly = form.amount && form.frequency
    ? calcMonthly((parseFloat(form.amount) || 0) * selectedCurrencyRate, form.frequency)
    : null
  const isForeignCurrency = form.currencyCode !== baseCurrency

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createYearMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to create budget year')),
    mutationFn: () =>
      api.post<BudgetYear>(`/households/${householdId}/budget-years`, {
        year: new Date().getFullYear(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.budgetYears(householdId) }),
  })

  const createMutation = useMutation({
    mutationFn: (data: ExpenseForm & { frequencyPeriod?: string; notes?: string }) =>
      api.post<Expense>(`/budget-years/${activeBudgetYear!.id}/expenses`, {
        ...data,
        amount: parseFloat(data.amount),
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
        ownership: data.ownership,
        ownedByUserId: data.ownership === 'INDIVIDUAL' ? data.ownedByUserId : undefined,
        customSplits: data.ownership === 'CUSTOM'
          ? data.customSplits.map((s) => ({ userId: s.userId, pct: parseFloat(s.pct) }))
          : undefined,
        accountId: data.accountId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setShowAdd(false)
      setForm(emptyForm(baseCurrency))
      setFormError('')
      toast.success('Expense added')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: ExpenseForm & { frequencyPeriod?: string; notes?: string }) =>
      api.put<Expense>(`/budget-years/${activeBudgetYear!.id}/expenses/${editingExpense!.id}`, {
        ...data,
        amount: parseFloat(data.amount),
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
        ownership: data.ownership,
        ownedByUserId: data.ownership === 'INDIVIDUAL' ? data.ownedByUserId : undefined,
        customSplits: data.ownership === 'CUSTOM'
          ? data.customSplits.map((s) => ({ userId: s.userId, pct: parseFloat(s.pct) }))
          : undefined,
        accountId: data.accountId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setEditingExpense(null)
      setForm(emptyForm(baseCurrency))
      setFormError('')
      toast.success('Expense updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
      }
    },
  })

  const deleteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete expense')),
    mutationFn: (id: string) =>
      api.delete(`/budget-years/${activeBudgetYear!.id}/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setDeleteTarget(null)
      toast.success('Expense deleted')
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (payload: { ids: string[]; categoryId?: string; accountId?: string | null }) =>
      api.patch(`/budget-years/${activeBudgetYear!.id}/expenses/bulk`, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setBulkEditOpen(false)
      setSelectedIds(new Set())
      setBulkForm({ categoryId: '', accountId: '' })
      setBulkError('')
      toast.success(`${variables.ids.length} expense${variables.ids.length !== 1 ? 's' : ''} updated`)
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setBulkError((err.response?.data as { error?: string })?.error ?? 'Failed to update')
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openAdd() {
    if (isReadOnly) return
    setForm(emptyForm(baseCurrency))
    setFormError('')
    setShowAdd(true)
  }

  function openEdit(expense: Expense) {
    if (isReadOnly) return
    setForm({
      label: expense.label,
      amount: expense.originalAmount ?? expense.amount,
      frequency: expense.frequency,
      categoryId: expense.category.id,
      frequencyPeriod: expense.frequencyPeriod ?? '',
      startMonth: expense.startMonth?.toString() ?? '',
      endMonth: expense.endMonth?.toString() ?? '',
      notes: expense.notes ?? '',
      currencyCode: expense.currencyCode ?? baseCurrency,
      ownership: expense.ownership ?? 'SHARED',
      ownedByUserId: expense.ownedByUserId ?? null,
      customSplits: expense.customSplits?.map((s) => ({ userId: s.userId, pct: s.pct })) ?? [],
      accountId: expense.account?.id ?? null,
    })
    setFormError('')
    setEditingExpense(expense)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (filtered.every((e) => selectedIds.has(e.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((e) => next.add(e.id))
        return next
      })
    }
  }

  function handleBulkSubmit(e: FormEvent) {
    e.preventDefault()
    setBulkError('')
    if (!bulkForm.categoryId && !bulkForm.accountId) {
      setBulkError('Select at least one field to change')
      return
    }
    const payload: { ids: string[]; categoryId?: string; accountId?: string | null } = {
      ids: [...selectedIds],
    }
    if (bulkForm.categoryId) payload.categoryId = bulkForm.categoryId
    if (bulkForm.accountId) payload.accountId = bulkForm.accountId === '__none__' ? null : bulkForm.accountId
    bulkUpdateMutation.mutate(payload)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (form.ownership === 'CUSTOM') {
      const total = customSplitTotal(form.customSplits)
      if (Math.abs(total - 100) > 0.01) {
        setFormError('Custom split percentages must sum to 100%')
        return
      }
    }
    const payload = {
      ...form,
      frequencyPeriod: form.frequencyPeriod || undefined,
      startMonth: form.startMonth ? parseInt(form.startMonth, 10) : null,
      endMonth: form.endMonth ? parseInt(form.endMonth, 10) : null,
      notes: form.notes || undefined,
    } as ExpenseForm & { startMonth: number | null; endMonth: number | null }
    if (editingExpense) updateMutation.mutate(payload)
    else createMutation.mutate(payload)
  }

  const isMutating = createMutation.isPending || updateMutation.isPending

  // ── Render ────────────────────────────────────────────────────────────────────

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown size={14} className="text-gray-700 ml-1" />
    return sortAsc
      ? <ChevronUp size={14} className="text-amber-400 ml-1" />
      : <ChevronDown size={14} className="text-amber-400 ml-1" />
  }

  const totalLabelColSpan = isReadOnly ? 4 : 5

  return (
    <>
      <main className={view === 'calendar' ? 'w-full px-6 py-8' : 'max-w-6xl mx-auto px-6 py-8'}>
        <PageHeader title="Expenses" />
        {/* Budget year selector */}
        <BudgetYearSelector
          budgetYears={budgetYears}
          activeBudgetYear={activeBudgetYear}
          onSelect={setSelectedYearId}
          isReadOnly={isReadOnly}
        />

        {yearsLoading ? (
          <PageLoader />
        ) : !activeBudgetYear ? (
          /* No budget year yet */
          <div className="text-center py-20">
            <p className="text-gray-400 mb-2">No budget year exists for this household.</p>
            <p className="text-gray-500 text-sm mb-6">Create one to start tracking expenses.</p>
            <button
              onClick={() => createYearMutation.mutate()}
              disabled={createYearMutation.isPending}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              {createYearMutation.isPending ? 'Creating…' : `Create ${new Date().getFullYear()} budget year`}
            </button>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-col gap-3 mb-4">
              {accountsInExpenses.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 mr-1">Account:</span>
                  {accountsInExpenses.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setFilterAccounts((prev) => {
                        const next = new Set(prev)
                        if (next.has(a.id)) next.delete(a.id); else next.add(a.id)
                        return next
                      })}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        filterAccounts.has(a.id)
                          ? 'bg-amber-400 border-amber-400 text-gray-950 font-medium'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {a.name}
                      <span className="ml-1 opacity-60">{ACCOUNT_TYPE_LABELS[a.type]}</span>
                    </button>
                  ))}
                  {filterAccounts.size > 0 && (
                    <button onClick={() => setFilterAccounts(new Set())} className="text-xs text-gray-600 hover:text-gray-400 transition-colors ml-1">
                      Clear
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <CategoryFilter
                  categories={categories}
                  selected={filterCategories}
                  onChange={setFilterCategories}
                />
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={segmentGroup}>
                    <button
                      onClick={() => setView('list')}
                      className={segmentBtn(view === 'list')}
                    >
                      List
                    </button>
                    <button
                      onClick={() => setView('calendar')}
                      className={segmentBtn(view === 'calendar')}
                    >
                      Calendar
                    </button>
                  </div>
                  {!isReadOnly && (
                    <button
                      onClick={openAdd}
                      className={primaryBtnSm}
                    >
                      + Add expense
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Bulk action bar */}
            {!isReadOnly && selectedIds.size > 0 && (
              <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-lg px-4 py-2.5 mb-3">
                <span className="text-amber-400 text-sm font-medium">{selectedIds.size} selected</span>
                <button
                  onClick={() => { setBulkForm({ categoryId: '', accountId: '' }); setBulkError(''); setBulkEditOpen(true) }}
                  className="text-sm bg-amber-400 text-gray-950 font-semibold px-3 py-1 rounded-lg hover:bg-amber-300 transition-colors"
                >
                  Edit selected
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-gray-400 hover:text-white transition-colors ml-auto"
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* Table / Calendar */}
            {expensesLoading ? (
              <PageLoader />
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                {expenses.length === 0 ? 'No plunder recorded yet. Add one to get started.' : 'No plunder matches the filter.'}
              </div>
            ) : view === 'calendar' ? (
              <ExpenseCalendar expenses={filtered} fmt={fmt} />
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-left select-none">
                      {!isReadOnly && (
                        <th className="pl-4 pr-2 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id))}
                            ref={(el) => { if (el) el.indeterminate = filtered.some((e) => selectedIds.has(e.id)) && !filtered.every((e) => selectedIds.has(e.id)) }}
                            onChange={toggleSelectAll}
                            className="accent-amber-400 cursor-pointer"
                            aria-label="Select all"
                          />
                        </th>
                      )}
                      <th className="px-4 py-3 font-medium">
                        <button onClick={() => handleSort('label')} className="hover:text-white flex items-center">
                          Label <SortIcon col="label" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button onClick={() => handleSort('category')} className="hover:text-white flex items-center">
                          Category <SortIcon col="category" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button onClick={() => handleSort('frequency')} className="hover:text-white flex items-center">
                          Frequency <SortIcon col="frequency" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        <button onClick={() => handleSort('amount')} className="hover:text-white flex items-center ml-auto">
                          Amount <SortIcon col="amount" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        <button onClick={() => handleSort('monthly')} className="hover:text-white flex items-center ml-auto">
                          /month <SortIcon col="monthly" />
                        </button>
                      </th>
                      {!isReadOnly && <th className="px-4 py-3 sr-only">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => {
                      // An expense has ended if its end month is behind today *in the viewed budget year*
                      const now = new Date()
                      const viewedYear = activeBudgetYear?.year ?? now.getFullYear()
                      const isPast = e.endMonth != null && (viewedYear < now.getFullYear() || (viewedYear === now.getFullYear() && e.endMonth < now.getMonth() + 1))
                      const rangeLabel = monthRangeLabel(e.startMonth, e.endMonth)
                      return (
                      <tr key={e.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group${isPast ? ' opacity-50' : ''}${selectedIds.has(e.id) ? ' bg-amber-400/5' : ''}`}>
                        {!isReadOnly && (
                          <td className="pl-4 pr-2 py-3 w-8">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(e.id)}
                              onChange={() => toggleSelect(e.id)}
                              className="accent-amber-400 cursor-pointer"
                              aria-label={`Select ${e.label}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-white">
                          <div className="flex items-center gap-2 flex-wrap">
                            {e.label}
                            {rangeLabel && (
                              <span className="text-xs bg-gray-700/60 text-gray-400 border border-gray-600/50 px-2 py-0.5 rounded-full">
                                {rangeLabel}
                              </span>
                            )}
                            {e.ownership === 'INDIVIDUAL' && e.ownedBy && (
                              <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
                                {e.ownedBy.name}
                              </span>
                            )}
                            {e.ownership === 'CUSTOM' && (
                              <span className="text-xs bg-purple-900/60 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full">
                                Custom split
                              </span>
                            )}
                            {e.notes && (
                              <span className="text-gray-600 text-xs" title={e.notes}>📝</span>
                            )}
                            {e.account && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                                {e.account.name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-300">
                          <span className="flex items-center gap-1.5">
                            {e.category.icon && (
                              <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                            )}
                            {e.category.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">
                          {FREQUENCIES.find((f) => f.value === e.frequency)?.label}
                          {e.frequencyPeriod && (
                            <span className="text-gray-500 text-xs ml-1">({e.frequencyPeriod})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                          {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
                          {e.currencyCode && (
                            <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">
                          {fmt(parseFloat(e.monthlyWhenActive))}
                        </td>
                        {!isReadOnly && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => openEdit(e)}
                                className="text-xs text-gray-400 hover:text-white transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteTarget(e)}
                                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )})}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 bg-gray-800/50">
                      <td colSpan={totalLabelColSpan} className="px-4 py-3 text-sm text-gray-400 font-medium">
                        Total{(filterCategories.size > 0 || filterAccounts.size > 0) ? ' (filtered)' : ''} — {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">
                        {fmt(totalMonthly)}
                      </td>
                      {!isReadOnly && <td />}
                    </tr>
                  </tfoot>
                </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Add / Edit modal */}
      {!isReadOnly && (showAdd || editingExpense) && (
        <Modal
          title={editingExpense ? 'Edit expense' : 'New expense'}
          onClose={() => { setShowAdd(false); setEditingExpense(null) }}
          size="lg"
        >
          <div className="max-h-[70vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                  autoFocus
                  placeholder="e.g. Rent"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Amount</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    required
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Frequency</label>
                  <select
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                    className={inputClass}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {currencies.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
                  <select
                    value={form.currencyCode}
                    onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}
                    className={inputClass}
                  >
                    <option value={baseCurrency}>{baseCurrency} (base)</option>
                    {currencies.filter((c) => c.code !== baseCurrency).sort((a, b) => a.code.localeCompare(b.code)).map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
              )}

              {previewMonthly !== null && (
                <p className="text-xs text-gray-500">
                  Monthly equivalent:{' '}
                  <span className="text-amber-400 font-medium">{fmt(previewMonthly)}</span>
                  {isForeignCurrency && form.amount && (
                    <span className="ml-2 text-gray-600">
                      ({fmt(parseFloat(form.amount), form.currencyCode)} × {selectedCurrencyRate.toFixed(4)})
                    </span>
                  )}
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  required
                  className={inputClass}
                >
                  <option value="">Select a category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
                  ))}
                </select>
              </div>
              {hasAccounts && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Account <span className="text-gray-600">(optional)</span>
                  </label>
                  <AccountSelect
                    value={form.accountId ?? ''}
                    onChange={(v) => setForm({ ...form, accountId: v || null })}
                    personal={personalAccounts}
                    household={householdAccountOptions}
                  >
                    <option value="">— None —</option>
                  </AccountSelect>
                </div>
              )}
              <OwnershipFields
                members={members}
                value={form}
                onChange={(next) => setForm({ ...form, ...next })}
              />
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Frequency period <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.frequencyPeriod}
                  onChange={(e) => setForm({ ...form, frequencyPeriod: e.target.value })}
                  placeholder="e.g. month 1 of quarter"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Active from <span className="text-gray-600">(optional)</span>
                  </label>
                  <select
                    value={form.startMonth}
                    onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Start of year</option>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Active until <span className="text-gray-600">(optional)</span>
                  </label>
                  <select
                    value={form.endMonth}
                    onChange={(e) => setForm({ ...form, endMonth: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">End of year</option>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Notes <span className="text-gray-600">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Any additional details…"
                  className={inputClass + ' resize-none'}
                />
              </div>

              <FormError message={formError} />
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isMutating}
                  className={`flex-1 ${primaryBtn}`}
                >
                  {isMutating ? 'Saving…' : editingExpense ? 'Save changes' : 'Add expense'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setEditingExpense(null) }}
                  className={`flex-1 ${secondaryBtn}`}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Bulk edit modal */}
      {!isReadOnly && bulkEditOpen && (
        <Modal
          title={`Edit ${selectedIds.size} expense${selectedIds.size !== 1 ? 's' : ''}`}
          onClose={() => setBulkEditOpen(false)}
          size="sm"
        >
          <p className="text-xs text-gray-500 mb-4">Only fields you change will be updated. Leave a field as "— unchanged —" to keep existing values.</p>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
              <select
                value={bulkForm.categoryId}
                onChange={(e) => setBulkForm({ ...bulkForm, categoryId: e.target.value })}
                className={inputClass}
              >
                <option value="">— unchanged —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
                ))}
              </select>
            </div>
            {hasAccounts && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Account</label>
                <AccountSelect
                  value={bulkForm.accountId}
                  onChange={(v) => setBulkForm({ ...bulkForm, accountId: v })}
                  personal={personalAccounts}
                  household={householdAccountOptions}
                >
                  <option value="">— unchanged —</option>
                  <option value="__none__">None (clear account)</option>
                </AccountSelect>
              </div>
            )}
            <FormError message={bulkError} />
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={bulkUpdateMutation.isPending}
                className={`flex-1 ${primaryBtn}`}
              >
                {bulkUpdateMutation.isPending ? 'Saving…' : 'Apply changes'}
              </button>
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className={`flex-1 ${secondaryBtn}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {!isReadOnly && deleteTarget && (
        <ConfirmDialog
          title="Delete expense"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          pending={deleteMutation.isPending}
          confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        >
          <p className="text-gray-300 text-sm mb-1">
            Are you sure you want to delete <span className="text-white font-medium">"{deleteTarget.label}"</span>?
          </p>
          <p className="text-gray-500 text-xs mb-6">This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

// ── EXP-005: Expense Calendar ─────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RECURRING_FREQS = new Set<Frequency>(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'])

function getMonthValues(expense: Expense): (number | null)[] {
  const start = expense.startMonth ?? 1
  const end = expense.endMonth ?? 12
  // For recurring frequencies show the per-active-month equivalent (already server-computed).
  // For lump-sum frequencies use the exact base-currency occurrence amount to avoid precision
  // loss from reconstructing via the rounded monthlyEquivalent field (e.g. 1000/3=333.33*3=999.99).
  const perMonth = parseFloat(expense.monthlyWhenActive)
  const perOccurrence = parseFloat(expense.amountInBase)
  const vals: (number | null)[] = Array(12).fill(null)
  switch (expense.frequency) {
    case 'WEEKLY':
    case 'FORTNIGHTLY':
    case 'MONTHLY':
      for (let m = start; m <= end; m++) vals[m - 1] = perMonth
      return vals
    case 'QUARTERLY':
      for (const m of [3, 6, 9, 12]) {
        if (m >= start && m <= end) vals[m - 1] = perOccurrence
      }
      return vals
    case 'BIANNUAL':
      for (const m of [6, 12]) {
        if (m >= start && m <= end) vals[m - 1] = perOccurrence
      }
      return vals
    case 'ANNUAL':
      vals[end - 1] = perOccurrence
      return vals
    default:
      for (let m = start; m <= end; m++) vals[m - 1] = perMonth
      return vals
  }
}

function ExpenseCalendar({ expenses, fmt }: { expenses: Expense[]; fmt: (v: number | string) => string }) {
  const rows = expenses.map((e) => {
    const values = getMonthValues(e)
    return { expense: e, values, rowTotal: values.reduce<number>((s, v) => s + (v ?? 0), 0) }
  })

  const colTotals = Array.from({ length: 12 }, (_, i) =>
    rows.reduce<number>((s, r) => s + (r.values[i] ?? 0), 0)
  )
  const grandTotal = colTotals.reduce((s, v) => s + v, 0)
  const colMax = Math.max(...colTotals, 1)

  function heatBg(value: number) {
    const opacity = Math.round((value / colMax) * 40) + 5
    return { background: `rgba(251, 191, 36, ${opacity / 100})` }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr className="text-gray-400">
            <th className="sticky left-0 z-10 bg-gray-900 border-b border-r border-gray-800 px-3 py-2.5 text-left font-medium min-w-[180px]">
              Expense
            </th>
            {MONTHS.map((m) => (
              <th key={m} className="border-b border-gray-800 px-2 py-2.5 text-right font-medium min-w-[70px]">{m}</th>
            ))}
            <th className="border-b border-l border-gray-800 px-3 py-2.5 text-right font-medium min-w-[80px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ expense: e, values, rowTotal }) => (
            <tr key={e.id} className="group">
              <td className="sticky left-0 z-10 bg-gray-950 group-hover:bg-gray-900 border-b border-r border-gray-800/60 px-3 py-2 transition-colors">
                <div className="flex items-center gap-1.5">
                  {e.category.icon && (
                    <CategoryIcon name={e.category.icon} size={12} className="text-gray-600 shrink-0" />
                  )}
                  <span className="text-gray-200 truncate max-w-[140px]" title={e.label}>{e.label}</span>
                  {RECURRING_FREQS.has(e.frequency) && (
                    <span className="text-gray-600 shrink-0" title="Monthly recurring">↻</span>
                  )}
                </div>
              </td>
              {values.map((v, i) =>
                v === null ? (
                  <td key={i} className="border-b border-gray-800/40 px-2 py-2 text-right text-gray-700">—</td>
                ) : (
                  <td key={i} className="border-b border-gray-800/40 px-2 py-2 text-right tabular-nums text-gray-200" style={heatBg(v)}>
                    {fmt(v)}
                  </td>
                )
              )}
              <td className="border-b border-l border-gray-800/60 px-3 py-2 text-right tabular-nums text-amber-400 font-medium">
                {fmt(rowTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky left-0 z-10 bg-gray-900 border-t border-r border-gray-700 px-3 py-2.5 text-gray-400 font-medium">
              Monthly total
            </td>
            {colTotals.map((total, i) => (
              <td key={i} className="border-t border-gray-700 px-2 py-2.5 text-right tabular-nums text-gray-300 font-medium" style={heatBg(total)}>
                {fmt(total)}
              </td>
            ))}
            <td className="border-t border-l border-gray-700 px-3 py-2.5 text-right tabular-nums text-amber-400 font-bold">
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
