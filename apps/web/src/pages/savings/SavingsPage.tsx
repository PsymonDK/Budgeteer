import { useState, useMemo, type FormEvent } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import {
  useBudgetYearAccounts, useBudgetYears, useCategories, useConfig, useCurrencies, useHouseholdDetail,
} from '../../api/queries'
import { PageLoader } from '../../components/LoadingSpinner'
import { PageHeader } from '../../components/PageHeader'
import { BudgetYearSelector } from '../../components/BudgetYearSelector'
import { customSplitTotal } from '../../components/OwnershipFields'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AccountFilterChips, accountsIn } from '../../components/entries/AccountFilterChips'
import { BulkSelectionBar } from '../../components/entries/RowSelection'
import { BulkEditModal, emptyBulkForm, type BulkEditForm } from '../../components/entries/BulkEditModal'
import { useRowSelection } from '../../hooks/useRowSelection'
import { primaryBtnSm } from '../../lib/styles'
import { useFmt } from '../../hooks/useFmt'
import { getApiError } from '../../lib/apiError'
import { SavingsTable } from './SavingsTable'
import { SavingsFormModal } from './SavingsFormModal'
import { emptyForm, type EntryForm, type SavingsEntry } from './types'

export function SavingsPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const fmt = useFmt()
  const [searchParams] = useSearchParams()
  const requestedYearId = searchParams.get('budgetYearId')
  const queryClient = useQueryClient()

  const [selectedYearId, setSelectedYearId] = useState<string | null>(requestedYearId)
  const [showAdd, setShowAdd] = useState(false)
  const [editingEntry, setEditingEntry] = useState<SavingsEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavingsEntry | null>(null)
  const [form, setForm] = useState<EntryForm>(emptyForm('DKK'))
  const [formError, setFormError] = useState('')
  const [filterAccounts, setFilterAccounts] = useState<Set<string>>(new Set())

  // Bulk edit state
  const { selectedIds, setSelectedIds, toggleSelect, toggleSelectAll } = useRowSelection()
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState<BulkEditForm>(emptyBulkForm())
  const [bulkError, setBulkError] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: budgetYears = [], isLoading: yearsLoading } = useBudgetYears(householdId)

  const activeBudgetYear = (
    selectedYearId
      ? budgetYears.find((y) => y.id === selectedYearId)
      : budgetYears.find((y) => y.status === 'ACTIVE') ?? budgetYears[0]
  ) ?? null

  const isReadOnly = activeBudgetYear?.status === 'RETIRED'

  const { data: entries = [], isLoading: entriesLoading } = useQuery<SavingsEntry[]>({
    queryKey: qk.savings(activeBudgetYear?.id),
    queryFn: async () =>
      (await api.get<SavingsEntry[]>(`/budget-years/${activeBudgetYear!.id}/savings`)).data,
    enabled: !!activeBudgetYear,
  })

  const { data: config } = useConfig()

  const { data: currencies = [] } = useCurrencies()

  const { data: householdData } = useHouseholdDetail(householdId)
  const members = householdData?.members ?? []

  const { data: savingsCategories = [] } = useCategories(householdId, 'SAVINGS')

  const { data: accountGroups } = useBudgetYearAccounts(activeBudgetYear?.id)
  const personalAccounts = accountGroups?.personal ?? []
  const householdAccountOptions = accountGroups?.household ?? []
  const hasAccounts = personalAccounts.length > 0 || householdAccountOptions.length > 0

  const baseCurrency = config?.baseCurrency ?? 'DKK'

  // ── Derived ───────────────────────────────────────────────────────────────────

  const accountsInEntries = useMemo(() => accountsIn(entries), [entries])

  const filteredEntries = useMemo(() => {
    if (filterAccounts.size === 0) return entries
    return entries.filter((e) => e.accountId != null && filterAccounts.has(e.accountId))
  }, [entries, filterAccounts])

  const totalMonthly = useMemo(
    () => filteredEntries.reduce((s, e) => s + parseFloat(e.monthlyEquivalent), 0),
    [filteredEntries]
  )

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.savings(activeBudgetYear?.id) })
    queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) })
  }

  const createMutation = useMutation({
    mutationFn: (data: EntryForm) =>
      api.post(`/budget-years/${activeBudgetYear!.id}/savings`, {
        label: data.label,
        amount: parseFloat(data.amount),
        frequency: data.frequency,
        notes: data.notes || undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
        ownership: data.ownership,
        ownedByUserId: data.ownership === 'INDIVIDUAL' ? data.ownedByUserId : undefined,
        categoryId: data.categoryId || undefined,
        customSplits: data.ownership === 'CUSTOM'
          ? data.customSplits.map((s) => ({ userId: s.userId, pct: parseFloat(s.pct) }))
          : undefined,
        accountId: data.accountId || null,
      }),
    onSuccess: () => {
      invalidate()
      setShowAdd(false)
      setForm(emptyForm(baseCurrency))
      setFormError('')
      toast.success('Savings entry saved')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: EntryForm) =>
      api.put(`/budget-years/${activeBudgetYear!.id}/savings/${editingEntry!.id}`, {
        label: data.label,
        amount: parseFloat(data.amount),
        frequency: data.frequency,
        notes: data.notes || undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
        ownership: data.ownership,
        ownedByUserId: data.ownership === 'INDIVIDUAL' ? data.ownedByUserId : undefined,
        categoryId: data.categoryId || null,
        customSplits: data.ownership === 'CUSTOM'
          ? data.customSplits.map((s) => ({ userId: s.userId, pct: parseFloat(s.pct) }))
          : undefined,
        accountId: data.accountId || null,
      }),
    onSuccess: () => {
      invalidate()
      setEditingEntry(null)
      setForm(emptyForm(baseCurrency))
      setFormError('')
      toast.success('Savings entry saved')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const deleteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete savings entry')),
    mutationFn: (id: string) =>
      api.delete(`/budget-years/${activeBudgetYear!.id}/savings/${id}`),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      toast.success('Savings entry deleted')
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (payload: { ids: string[]; categoryId?: string | null; accountId?: string | null }) =>
      api.patch(`/budget-years/${activeBudgetYear!.id}/savings/bulk`, payload),
    onSuccess: (_data, variables) => {
      invalidate()
      setBulkEditOpen(false)
      setSelectedIds(new Set())
      setBulkForm(emptyBulkForm())
      setBulkError('')
      toast.success(`${variables.ids.length} entr${variables.ids.length !== 1 ? 'ies' : 'y'} updated`)
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setBulkError((err.response?.data as { error?: string })?.error ?? 'Failed to update')
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openAdd() { setForm(emptyForm(baseCurrency)); setFormError(''); setShowAdd(true) }

  function openEdit(e: SavingsEntry) {
    setForm({
      label: e.label,
      amount: e.originalAmount ?? e.amount,
      frequency: e.frequency,
      notes: e.notes ?? '',
      currencyCode: e.currencyCode ?? baseCurrency,
      ownership: e.ownership ?? 'SHARED',
      ownedByUserId: e.ownedByUserId ?? null,
      categoryId: e.categoryId ?? '',
      customSplits: e.customSplits?.map((s) => ({ userId: s.userId, pct: s.pct })) ?? [],
      accountId: e.account?.id ?? null,
    })
    setFormError('')
    setEditingEntry(e)
  }

  function handleBulkSubmit(e: FormEvent) {
    e.preventDefault()
    setBulkError('')
    if (!bulkForm.categoryId && !bulkForm.accountId) {
      setBulkError('Select at least one field to change')
      return
    }
    const payload: { ids: string[]; categoryId?: string | null; accountId?: string | null } = {
      ids: [...selectedIds],
    }
    if (bulkForm.categoryId) payload.categoryId = bulkForm.categoryId === '__none__' ? null : bulkForm.categoryId
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
    if (editingEntry) updateMutation.mutate(form)
    else createMutation.mutate(form)
  }

  const isMutating = createMutation.isPending || updateMutation.isPending

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Budget year selector */}
        <BudgetYearSelector
          budgetYears={budgetYears}
          activeBudgetYear={activeBudgetYear}
          onSelect={setSelectedYearId}
          isReadOnly={isReadOnly}
        />

        <PageHeader
          title="Savings"
          subtitle="Planned savings entries for this budget year."
          action={!isReadOnly && activeBudgetYear ? (
            <button
              onClick={openAdd}
              className={primaryBtnSm}
            >
              + Add savings
            </button>
          ) : undefined}
        />

        <AccountFilterChips
          accounts={accountsInEntries}
          selected={filterAccounts}
          setSelected={setFilterAccounts}
          className="mb-4"
        />

        {yearsLoading ? (
          <PageLoader />
        ) : !activeBudgetYear ? (
          <div className="text-center py-20 text-gray-500">
            <p className="mb-2">No budget year exists for this household.</p>
            <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300 text-sm">
              Go to Expenses to create one →
            </Link>
          </div>
        ) : entriesLoading ? (
          <PageLoader />
        ) : entries.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="mb-1">No gold stashed yet.</p>
            {!isReadOnly && (
              <p className="text-sm">
                <button onClick={openAdd} className="text-amber-400 hover:text-amber-300">Add your first savings entry →</button>
              </p>
            )}
          </div>
        ) : (
          <>
          {selectedIds.size > 0 && !isReadOnly && (
            <BulkSelectionBar
              count={selectedIds.size}
              onEdit={() => { setBulkForm(emptyBulkForm()); setBulkError(''); setBulkEditOpen(true) }}
              onClear={() => setSelectedIds(new Set())}
            />
          )}
          <SavingsTable
            entries={filteredEntries}
            isReadOnly={isReadOnly}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={() => toggleSelectAll(filteredEntries)}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            isFiltered={filterAccounts.size > 0}
            totalMonthly={totalMonthly}
            baseCurrency={baseCurrency}
            fmt={fmt}
          />
          </>
        )}
      </main>

      {/* Add / Edit modal */}
      {(showAdd || editingEntry) && (
        <SavingsFormModal
          isEditing={!!editingEntry}
          form={form}
          setForm={setForm}
          error={formError}
          pending={isMutating}
          onSubmit={handleSubmit}
          onClose={() => { setShowAdd(false); setEditingEntry(null) }}
          savingsCategories={savingsCategories}
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
      {bulkEditOpen && (
        <BulkEditModal
          title={`Edit ${selectedIds.size} entr${selectedIds.size !== 1 ? 'ies' : 'y'}`}
          form={bulkForm}
          setForm={setBulkForm}
          categories={savingsCategories}
          showCategory={savingsCategories.length > 0}
          allowClearCategory
          hasAccounts={hasAccounts}
          personalAccounts={personalAccounts}
          householdAccounts={householdAccountOptions}
          error={bulkError}
          pending={bulkUpdateMutation.isPending}
          onSubmit={handleBulkSubmit}
          onClose={() => setBulkEditOpen(false)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete savings entry"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          pending={deleteMutation.isPending}
          confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        >
          <p className="text-gray-300 text-sm mb-1">
            Delete <span className="text-white font-medium">"{deleteTarget.label}"</span>?
          </p>
          <p className="text-gray-500 text-xs mb-6">This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
