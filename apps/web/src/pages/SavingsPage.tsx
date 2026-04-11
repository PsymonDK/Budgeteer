import { useState, useMemo, type FormEvent } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../api/client'
import { CategoryIcon } from '../components/CategoryIcon'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'
import { FREQUENCIES, type Frequency } from '../lib/constants'
import { useFmt } from '../hooks/useFmt'

// ── Types ─────────────────────────────────────────────────────────────────────

type SavingsOwnership = 'SHARED' | 'INDIVIDUAL' | 'CUSTOM'

interface CustomSplitInput {
  userId: string
  pct: string
}

interface SavingsCategory {
  id: string
  name: string
  icon: string | null
  isSystemWide: boolean
  categoryType: 'EXPENSE' | 'SAVINGS'
}

interface HouseholdMember {
  userId: string
  user: { id: string; name: string }
}

type AccountType = 'BANK' | 'CREDIT_CARD' | 'MOBILE_PAY'

interface AccountInfo {
  id: string
  name: string
  type: AccountType
}

interface AccountGroups {
  personal: AccountInfo[]
  household: AccountInfo[]
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: 'Bank',
  CREDIT_CARD: 'Credit card',
  MOBILE_PAY: 'Mobile pay',
}

interface SavingsEntry {
  id: string
  label: string
  amount: string
  frequency: Frequency
  monthlyEquivalent: string
  notes: string | null
  currencyCode: string | null
  originalAmount: string | null
  rateUsed: string | null
  ownership: SavingsOwnership
  ownedByUserId: string | null
  ownedBy: { id: string; name: string } | null
  categoryId: string | null
  category: SavingsCategory | null
  customSplits: { userId: string; user: { id: string; name: string }; pct: string }[]
  accountId: string | null
  account: AccountInfo | null
}

interface Currency {
  code: string
  rate: number
  baseCurrency: string
}

interface BudgetYear {
  id: string
  year: number
  status: 'ACTIVE' | 'FUTURE' | 'RETIRED' | 'SIMULATION'
  simulationName: string | null
}

interface EntryForm {
  label: string
  amount: string
  frequency: Frequency
  notes: string
  currencyCode: string
  ownership: SavingsOwnership
  ownedByUserId: string | null
  categoryId: string
  customSplits: CustomSplitInput[]
  accountId: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const emptyForm = (baseCurrency: string): EntryForm => ({
  label: '', amount: '', frequency: 'MONTHLY', notes: '', currencyCode: baseCurrency,
  ownership: 'SHARED', ownedByUserId: null, categoryId: '', customSplits: [], accountId: null,
})

function calcMonthly(amount: number, freq: Frequency): number {
  switch (freq) {
    case 'WEEKLY':      return amount * 52 / 12
    case 'FORTNIGHTLY': return amount * 26 / 12
    case 'MONTHLY':     return amount
    case 'QUARTERLY':   return amount / 3
    case 'BIANNUAL':    return amount / 6
    case 'ANNUAL':      return amount / 12
  }
}

function yearLabel(y: BudgetYear) {
  if (y.status === 'SIMULATION') return `${y.year} — ${y.simulationName ?? 'Simulation'}`
  return `${y.year} (${y.status.charAt(0) + y.status.slice(1).toLowerCase()})`
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState<{ categoryId: string; accountId: string }>({ categoryId: '', accountId: '' })
  const [bulkError, setBulkError] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: budgetYears = [], isLoading: yearsLoading } = useQuery<BudgetYear[]>({
    queryKey: ['budget-years', householdId],
    queryFn: async () => (await api.get<BudgetYear[]>(`/households/${householdId}/budget-years`)).data,
    enabled: !!householdId,
  })

  const activeBudgetYear = (
    selectedYearId
      ? budgetYears.find((y) => y.id === selectedYearId)
      : budgetYears.find((y) => y.status === 'ACTIVE') ?? budgetYears[0]
  ) ?? null

  const isReadOnly = activeBudgetYear?.status === 'RETIRED'

  const { data: entries = [], isLoading: entriesLoading } = useQuery<SavingsEntry[]>({
    queryKey: ['savings', activeBudgetYear?.id],
    queryFn: async () =>
      (await api.get<SavingsEntry[]>(`/budget-years/${activeBudgetYear!.id}/savings`)).data,
    enabled: !!activeBudgetYear,
  })

  const { data: config } = useQuery<{ baseCurrency: string }>({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ baseCurrency: string }>('/config')).data,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const { data: householdData } = useQuery<{ members: HouseholdMember[] }>({
    queryKey: ['household', householdId],
    queryFn: async () => (await api.get(`/households/${householdId}`)).data,
    enabled: !!householdId,
  })
  const members = householdData?.members ?? []

  const { data: savingsCategories = [] } = useQuery<SavingsCategory[]>({
    queryKey: ['categories', householdId, 'SAVINGS'],
    queryFn: async () =>
      (await api.get<SavingsCategory[]>(`/categories?householdId=${householdId}&type=SAVINGS`)).data,
    enabled: !!householdId,
  })

  const { data: accountGroups } = useQuery<AccountGroups>({
    queryKey: ['accounts-for-budget-year', activeBudgetYear?.id],
    queryFn: async () => (await api.get<AccountGroups>(`/budget-years/${activeBudgetYear!.id}/accounts`)).data,
    enabled: !!activeBudgetYear,
  })
  const personalAccounts = accountGroups?.personal ?? []
  const householdAccountOptions = accountGroups?.household ?? []
  const hasAccounts = personalAccounts.length > 0 || householdAccountOptions.length > 0

  const baseCurrency = config?.baseCurrency ?? 'DKK'

  // ── Derived ───────────────────────────────────────────────────────────────────

  const accountsInEntries = useMemo(() => {
    const map = new Map<string, AccountInfo>()
    for (const e of entries) {
      if (e.account) map.set(e.account.id, e.account)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  const filteredEntries = useMemo(() => {
    if (filterAccounts.size === 0) return entries
    return entries.filter((e) => e.accountId != null && filterAccounts.has(e.accountId))
  }, [entries, filterAccounts])

  const totalMonthly = useMemo(
    () => filteredEntries.reduce((s, e) => s + parseFloat(e.monthlyEquivalent), 0),
    [filteredEntries]
  )

  const selectedCurrencyRate = currencies.find((c) => c.code === form.currencyCode)?.rate ?? 1
  const previewMonthly = form.amount && form.frequency
    ? calcMonthly((parseFloat(form.amount) || 0) * selectedCurrencyRate, form.frequency)
    : null
  const isForeignCurrency = form.currencyCode !== baseCurrency

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['savings', activeBudgetYear?.id] })
    queryClient.invalidateQueries({ queryKey: ['dashboard', householdId] })
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
      setBulkForm({ categoryId: '', accountId: '' })
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (filteredEntries.every((e) => selectedIds.has(e.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filteredEntries.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filteredEntries.forEach((e) => next.add(e.id))
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
      const total = form.customSplits.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
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

  const colSpan = isReadOnly ? 5 : 7

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Budget year selector */}
        {budgetYears.length > 0 && (
          <div className="mb-6 flex items-center gap-3">
            {budgetYears.length === 1 ? (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                activeBudgetYear?.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' :
                activeBudgetYear?.status === 'FUTURE' ? 'bg-blue-900/50 text-blue-300' :
                activeBudgetYear?.status === 'SIMULATION' ? 'bg-purple-900/50 text-purple-300' :
                'bg-gray-800 text-gray-400'
              }`}>
                {activeBudgetYear ? yearLabel(activeBudgetYear) : ''}
              </span>
            ) : (
              <select
                value={activeBudgetYear?.id ?? ''}
                onChange={(e) => setSelectedYearId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {budgetYears.map((y) => (
                  <option key={y.id} value={y.id}>{yearLabel(y)}</option>
                ))}
              </select>
            )}
            {isReadOnly && (
              <span className="text-xs text-gray-600 italic">Read-only (retired)</span>
            )}
          </div>
        )}

        <PageHeader
          title="Savings"
          subtitle="Planned savings entries for this budget year."
          action={!isReadOnly && activeBudgetYear ? (
            <button
              onClick={openAdd}
              className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              + Add savings
            </button>
          ) : undefined}
        />

        {accountsInEntries.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-xs text-gray-500 mr-1">Account:</span>
            {accountsInEntries.map((a) => (
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  {!isReadOnly && (
                    <th className="pl-4 pr-2 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={filteredEntries.length > 0 && filteredEntries.every((e) => selectedIds.has(e.id))}
                        ref={(el) => { if (el) el.indeterminate = filteredEntries.some((e) => selectedIds.has(e.id)) && !filteredEntries.every((e) => selectedIds.has(e.id)) }}
                        onChange={toggleSelectAll}
                        className="accent-amber-400 cursor-pointer"
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Frequency</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">/ month</th>
                  {!isReadOnly && <th className="px-4 py-3 sr-only">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => (
                  <tr key={e.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group${selectedIds.has(e.id) ? ' bg-amber-400/5' : ''}`}>
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
                        {e.notes && <span className="ml-1 text-gray-600 text-xs" title={e.notes}>📝</span>}
                        {e.account && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                            {e.account.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {e.category ? (
                        <span className="flex items-center gap-1.5">
                          {e.category.icon && (
                            <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />
                          )}
                          {e.category.name}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {FREQUENCIES.find((f) => f.value === e.frequency)?.label}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                      {fmt(parseFloat(e.originalAmount ?? e.amount))}
                      {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">
                      {fmt(parseFloat(e.monthlyEquivalent))}
                      <span className="ml-1 text-xs text-gray-500">{baseCurrency}</span>
                    </td>
                    {!isReadOnly && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(e)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                          <button onClick={() => setDeleteTarget(e)} className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/50">
                  <td colSpan={colSpan - 1} className="px-4 py-3 text-sm text-gray-400 font-medium">
                    Total{filterAccounts.size > 0 ? ' (filtered)' : ''} — {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">{fmt(totalMonthly)}</td>
                  {!isReadOnly && <td />}
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
          </>
        )}
      </main>

      {/* Add / Edit modal */}
      {(showAdd || editingEntry) && (
        <Modal
          title={editingEntry ? 'Edit savings entry' : 'New savings entry'}
          onClose={() => { setShowAdd(false); setEditingEntry(null) }}
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
                  placeholder="e.g. Emergency fund"
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
                  <span className="text-amber-400 font-medium">{fmt(previewMonthly)} {baseCurrency}</span>
                  {isForeignCurrency && form.amount && (
                    <span className="ml-2 text-gray-600">
                      ({fmt(parseFloat(form.amount))} {form.currencyCode} × {selectedCurrencyRate.toFixed(4)})
                    </span>
                  )}
                </p>
              )}

              {savingsCategories.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Category <span className="text-gray-600">(optional)</span>
                  </label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">No category</option>
                    {savingsCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
                    ))}
                  </select>
                </div>
              )}

              {hasAccounts && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Account <span className="text-gray-600">(optional)</span>
                  </label>
                  <select
                    value={form.accountId ?? ''}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value || null })}
                    className={inputClass}
                  >
                    <option value="">— None —</option>
                    {personalAccounts.length > 0 && (
                      <optgroup label="My accounts">
                        {personalAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
                        ))}
                      </optgroup>
                    )}
                    {householdAccountOptions.length > 0 && (
                      <optgroup label="Household accounts">
                        {householdAccountOptions.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}

              {members.length > 0 && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Ownership</label>
                    <select
                      value={form.ownership}
                      onChange={(e) => setForm({ ...form, ownership: e.target.value as SavingsOwnership, ownedByUserId: null, customSplits: [] })}
                      className={inputClass}
                    >
                      <option value="SHARED">Shared (split by income %)</option>
                      <option value="INDIVIDUAL">Individual (one member)</option>
                      <option value="CUSTOM">Custom split</option>
                    </select>
                  </div>
                  {form.ownership === 'INDIVIDUAL' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Assigned to</label>
                      <select
                        value={form.ownedByUserId ?? ''}
                        onChange={(e) => setForm({ ...form, ownedByUserId: e.target.value || null })}
                        required
                        className={inputClass}
                      >
                        <option value="">Select member…</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>{m.user.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.ownership === 'CUSTOM' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2">Custom split %</label>
                      <div className="space-y-2">
                        {members.map((m) => {
                          const split = form.customSplits.find((s) => s.userId === m.userId)
                          return (
                            <div key={m.userId} className="flex items-center gap-3">
                              <span className="text-sm text-gray-300 flex-1">{m.user.name}</span>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={split?.pct ?? ''}
                                onChange={(ev) => {
                                  const next = form.customSplits.filter((s) => s.userId !== m.userId)
                                  if (ev.target.value) next.push({ userId: m.userId, pct: ev.target.value })
                                  setForm({ ...form, customSplits: next })
                                }}
                                placeholder="0"
                                className={inputClass + ' w-24 text-right'}
                              />
                              <span className="text-xs text-gray-500 w-4">%</span>
                            </div>
                          )
                        })}
                        {(() => {
                          const total = form.customSplits.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
                          return (
                            <p className={`text-xs text-right ${Math.abs(total - 100) < 0.01 ? 'text-green-400' : 'text-amber-400'}`}>
                              Total: {total.toFixed(1)}%{Math.abs(total - 100) < 0.01 ? '' : ' (must equal 100%)'}
                            </p>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}

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

              {formError && (
                <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{formError}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isMutating}
                  className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
                >
                  {isMutating ? 'Saving…' : editingEntry ? 'Save changes' : 'Add savings'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setEditingEntry(null) }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Bulk edit modal */}
      {bulkEditOpen && (
        <Modal
          title={`Edit ${selectedIds.size} entr${selectedIds.size !== 1 ? 'ies' : 'y'}`}
          onClose={() => setBulkEditOpen(false)}
          size="sm"
        >
          <p className="text-xs text-gray-500 mb-4">Only fields you change will be updated. Leave a field as "— unchanged —" to keep existing values.</p>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            {savingsCategories.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
                <select
                  value={bulkForm.categoryId}
                  onChange={(e) => setBulkForm({ ...bulkForm, categoryId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— unchanged —</option>
                  <option value="__none__">None (clear category)</option>
                  {savingsCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
                  ))}
                </select>
              </div>
            )}
            {hasAccounts && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Account</label>
                <select
                  value={bulkForm.accountId}
                  onChange={(e) => setBulkForm({ ...bulkForm, accountId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— unchanged —</option>
                  <option value="__none__">None (clear account)</option>
                  {personalAccounts.length > 0 && (
                    <optgroup label="My accounts">
                      {personalAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
                      ))}
                    </optgroup>
                  )}
                  {householdAccountOptions.length > 0 && (
                    <optgroup label="Household accounts">
                      {householdAccountOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            {bulkError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{bulkError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={bulkUpdateMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {bulkUpdateMutation.isPending ? 'Saving…' : 'Apply changes'}
              </button>
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Modal title="Delete savings entry" onClose={() => setDeleteTarget(null)} size="sm">
          <p className="text-gray-300 text-sm mb-1">
            Delete <span className="text-white font-medium">"{deleteTarget.label}"</span>?
          </p>
          <p className="text-gray-500 text-xs mb-6">This cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
