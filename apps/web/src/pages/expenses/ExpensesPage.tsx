import { useState, useMemo, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import {
  useBudgetYearAccounts, useBudgetYears, useCategories, useCurrencies, useHouseholdDetail,
} from '../../api/queries'
import type { BudgetYear } from '../../api/types'
import { PageLoader } from '../../components/LoadingSpinner'
import { PageHeader } from '../../components/PageHeader'
import { CategoryFilter } from '../../components/CategoryFilter'
import { BudgetYearSelector } from '../../components/BudgetYearSelector'
import { customSplitTotal } from '../../components/OwnershipFields'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AccountFilterChips, accountsIn } from '../../components/entries/AccountFilterChips'
import { BulkSelectionBar } from '../../components/entries/RowSelection'
import { BulkEditModal, emptyBulkForm, type BulkEditForm } from '../../components/entries/BulkEditModal'
import { useRowSelection } from '../../hooks/useRowSelection'
import { useAddFromQuery } from '../../hooks/useAddFromQuery'
import { primaryBtnSm, segmentGroup, segmentBtn } from '../../lib/styles'
import { useFmt, useBaseCurrency } from '../../hooks/useFmt'
import { getApiError } from '../../lib/apiError'
import { emptyForm, filterAndSortExpenses, formFromExpense } from './helpers'
import { ExpensesTable } from './ExpensesTable'
import { ExpenseDetail } from './ExpenseDetail'
import { ListWithDetail, useDetailSelection } from '../../components/DetailPane'
import { FilteredList, type FilterFacet } from '../../components/FilterColumn'
import { CategoryIcon } from '../../components/CategoryIcon'
import { ACCOUNT_TYPE_LABELS } from '../../lib/constants'
import { ExpenseCalendar } from './ExpenseCalendar'
import { ExpenseFormModal } from './ExpenseFormModal'
import type { Expense, ExpenseForm, SortKey } from './types'
import { restoreUrl, useTrashedToast } from '../../hooks/useTrash'
import { Page } from '../../components/Page'

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
  const { selectedIds, setSelectedIds, toggleSelect, toggleSelectAll } = useRowSelection()
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState<BulkEditForm>(emptyBulkForm())
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

  const accountsInExpenses = useMemo(() => accountsIn(expenses), [expenses])

  // Filter column (4K): the same filters as the chips, with how many expenses have each value
  const facets = useMemo<FilterFacet[]>(() => {
    const byCategory = new Map<string, number>()
    const byAccount = new Map<string, number>()
    for (const e of expenses) {
      byCategory.set(e.category.id, (byCategory.get(e.category.id) ?? 0) + 1)
      if (e.account) byAccount.set(e.account.id, (byAccount.get(e.account.id) ?? 0) + 1)
    }
    return [
      {
        key: 'category', title: 'Category', total: expenses.length, selected: filterCategories, onChange: setFilterCategories,
        options: categories
          .filter((c) => byCategory.has(c.id) || filterCategories.has(c.id))
          .map((c) => ({
            id: c.id, label: c.name, count: byCategory.get(c.id) ?? 0,
            icon: c.icon ? <CategoryIcon name={c.icon} size={14} className="text-gray-500 shrink-0" /> : undefined,
          })),
      },
      {
        key: 'account', title: 'Account', total: expenses.length, selected: filterAccounts, onChange: setFilterAccounts,
        options: accountsInExpenses.map((a) => ({ id: a.id, label: a.name, hint: ACCOUNT_TYPE_LABELS[a.type], count: byAccount.get(a.id) ?? 0 })),
      },
    ]
  }, [expenses, categories, accountsInExpenses, filterCategories, filterAccounts])

  const filtered = useMemo(
    () => filterAndSortExpenses(expenses, filterCategories, filterAccounts, sortKey, sortAsc),
    [expenses, filterAccounts, filterCategories, sortKey, sortAsc],
  )

  const totalMonthly = useMemo(
    () => filtered.reduce((sum, e) => sum + parseFloat(e.monthlyWhenActive), 0),
    [filtered]
  )

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

  const trashedToast = useTrashedToast()
  const deleteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete expense')),
    mutationFn: (id: string) =>
      api.delete(`/budget-years/${activeBudgetYear!.id}/expenses/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setDeleteTarget(null)
      if (householdId) trashedToast('Expense deleted', restoreUrl({ householdId }, 'expense', id))
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (payload: { ids: string[]; categoryId?: string; accountId?: string | null }) =>
      api.patch(`/budget-years/${activeBudgetYear!.id}/expenses/bulk`, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.expenses(activeBudgetYear?.id) })
      setBulkEditOpen(false)
      setSelectedIds(new Set())
      setBulkForm(emptyBulkForm())
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

  useAddFromQuery(yearsLoading ? null : !!activeBudgetYear && !isReadOnly, openAdd)

  // Wide screens show the clicked row in a side pane; elsewhere a click opens the edit form
  const detail = useDetailSelection()
  const activeExpense = view === 'list' && detail.selectedId ? filtered.find((e) => e.id === detail.selectedId) ?? null : null
  function openRow(expense: Expense) {
    if (detail.showsPane) detail.select(expense.id === detail.selectedId ? null : expense.id)
    else openEdit(expense)
  }

  function openEdit(expense: Expense) {
    if (isReadOnly) return
    setForm(formFromExpense(expense, baseCurrency))
    setFormError('')
    setEditingExpense(expense)
  }

  function closeForm() {
    setShowAdd(false); setEditingExpense(null)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(true) }
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

  return (
    <>
      <Page template="list">
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
              <AccountFilterChips accounts={accountsInExpenses} selected={filterAccounts} setSelected={setFilterAccounts} className="ultra:hidden" />
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* From 2200px the filter column replaces the chips */}
                <div className="ultra:hidden">
                  <CategoryFilter
                    categories={categories}
                    selected={filterCategories}
                    onChange={setFilterCategories}
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
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

            <FilteredList facets={facets}>
            {/* Bulk action bar */}
            {!isReadOnly && selectedIds.size > 0 && (
              <BulkSelectionBar
                count={selectedIds.size}
                onEdit={() => { setBulkForm(emptyBulkForm()); setBulkError(''); setBulkEditOpen(true) }}
                onClear={() => setSelectedIds(new Set())}
              />
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
              <ListWithDetail
                detail={activeExpense && (
                  <ExpenseDetail
                    expense={activeExpense}
                    isReadOnly={isReadOnly}
                    baseCurrency={baseCurrency}
                    onClose={() => detail.select(null)}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    fmt={fmt}
                  />
                )}
              >
              <ExpensesTable
                expenses={filtered}
                isReadOnly={isReadOnly}
                viewedYear={activeBudgetYear?.year}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={() => toggleSelectAll(filtered)}
                onOpen={openRow}
                activeId={activeExpense?.id ?? null}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                isFiltered={filterCategories.size > 0 || filterAccounts.size > 0}
                totalMonthly={totalMonthly}
                fmt={fmt}
              />
              </ListWithDetail>
            )}
            </FilteredList>
          </>
        )}
      </Page>

      {/* Add / Edit modal */}
      {!isReadOnly && (showAdd || editingExpense) && (
        <ExpenseFormModal
          isEditing={!!editingExpense}
          form={form}
          setForm={setForm}
          error={formError}
          pending={isMutating}
          onSubmit={handleSubmit}
          onClose={closeForm}
          categories={categories}
          currencies={currencies}
          baseCurrency={baseCurrency}
          members={members}
          hasAccounts={hasAccounts}
          personalAccounts={personalAccounts}
          householdAccounts={householdAccountOptions}
          fmt={fmt}
        />
      )}

      {/* Bulk edit modal */}
      {!isReadOnly && bulkEditOpen && (
        <BulkEditModal
          title={`Edit ${selectedIds.size} expense${selectedIds.size !== 1 ? 's' : ''}`}
          form={bulkForm}
          setForm={setBulkForm}
          categories={categories}
          showCategory
          allowClearCategory={false}
          hasAccounts={hasAccounts}
          personalAccounts={personalAccounts}
          householdAccounts={householdAccountOptions}
          error={bulkError}
          pending={bulkUpdateMutation.isPending}
          onSubmit={handleBulkSubmit}
          onClose={() => setBulkEditOpen(false)}
        />
      )}

      {/* Delete confirmation */}
      {!isReadOnly && deleteTarget && (
        <ConfirmDialog
          title="Move to trash"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          pending={deleteMutation.isPending}
          confirmLabel={deleteMutation.isPending ? 'Moving…' : 'Move to trash'}
        >
          <p className="text-gray-300 text-sm mb-1">
            Move <span className="text-white font-medium">"{deleteTarget.label}"</span> to the trash?
          </p>
          <p className="text-gray-500 text-xs mb-6">It stops counting toward totals and transfers. You can restore it from Trash.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
