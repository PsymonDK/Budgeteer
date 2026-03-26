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
import { inputClass } from '../lib/styles'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string
  name: string
  icon: string | null
  isSystemWide: boolean
}

interface Expense {
  id: string
  label: string
  amount: string
  frequency: Frequency
  frequencyPeriod: string | null
  monthlyEquivalent: string
  notes: string | null
  category: Category
  currencyCode: string | null
  originalAmount: string | null
  rateUsed: string | null
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

type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL'
type SortKey = 'label' | 'category' | 'amount' | 'frequency' | 'monthly'

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'WEEKLY',      label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'MONTHLY',     label: 'Monthly' },
  { value: 'QUARTERLY',   label: 'Quarterly' },
  { value: 'BIANNUAL',    label: 'Every 6 months' },
  { value: 'ANNUAL',      label: 'Annually' },
]

const FREQ_ORDER: Record<Frequency, number> = {
  WEEKLY: 0, FORTNIGHTLY: 1, MONTHLY: 2, QUARTERLY: 3, BIANNUAL: 4, ANNUAL: 5,
}

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

function fmt(value: number): string {
  return value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Expense form state ────────────────────────────────────────────────────────

interface ExpenseForm {
  label: string
  amount: string
  frequency: Frequency
  categoryId: string
  frequencyPeriod: string
  notes: string
  currencyCode: string
}

const emptyForm = (baseCurrency: string): ExpenseForm => ({
  label: '', amount: '', frequency: 'MONTHLY', categoryId: '', frequencyPeriod: '', notes: '', currencyCode: baseCurrency,
})

// ── Component ─────────────────────────────────────────────────────────────────

function yearLabel(y: BudgetYear) {
  if (y.status === 'SIMULATION') return `${y.year} — ${y.simulationName ?? 'Simulation'}`
  return `${y.year} (${y.status.charAt(0) + y.status.slice(1).toLowerCase()})`
}

export function ExpensesPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const requestedYearId = searchParams.get('budgetYearId')
  const queryClient = useQueryClient()

  // Sort / filter state
  const [sortKey, setSortKey] = useState<SortKey>('category')
  const [sortAsc, setSortAsc] = useState(true)
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set())

  // Modal state
  const [showAdd, setShowAdd] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyForm('DKK'))
  const [formError, setFormError] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: budgetYears = [], isLoading: yearsLoading } = useQuery<BudgetYear[]>({
    queryKey: ['budget-years', householdId],
    queryFn: async () => (await api.get<BudgetYear[]>(`/households/${householdId}/budget-years`)).data,
    enabled: !!householdId,
  })

  // Respect ?budgetYearId param; otherwise default to active year or most recent
  const [selectedYearId, setSelectedYearId] = useState<string | null>(requestedYearId)
  const activeBudgetYear = (
    selectedYearId
      ? budgetYears.find((y) => y.id === selectedYearId)
      : budgetYears.find((y) => y.status === 'ACTIVE') ?? budgetYears[0]
  ) ?? null

  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ['expenses', activeBudgetYear?.id],
    queryFn: async () =>
      (await api.get<Expense[]>(`/budget-years/${activeBudgetYear!.id}/expenses`)).data,
    enabled: !!activeBudgetYear,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', householdId],
    queryFn: async () =>
      (await api.get<Category[]>(`/categories?householdId=${householdId}`)).data,
    enabled: !!householdId,
  })

  const { data: config } = useQuery<{ baseCurrency: string }>({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ baseCurrency: string }>('/config')).data,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const baseCurrency = config?.baseCurrency ?? 'DKK'

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = filterCategories.size > 0
      ? expenses.filter((e) => filterCategories.has(e.category.id))
      : expenses

    return [...list].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'label':     cmp = a.label.localeCompare(b.label); break
        case 'category':  cmp = a.category.name.localeCompare(b.category.name); break
        case 'amount':    cmp = parseFloat(a.amount) - parseFloat(b.amount); break
        case 'frequency': cmp = FREQ_ORDER[a.frequency] - FREQ_ORDER[b.frequency]; break
        case 'monthly':   cmp = parseFloat(a.monthlyEquivalent) - parseFloat(b.monthlyEquivalent); break
      }
      return sortAsc ? cmp : -cmp
    })
  }, [expenses, filterCategories, sortKey, sortAsc])

  const totalMonthly = useMemo(
    () => filtered.reduce((sum, e) => sum + parseFloat(e.monthlyEquivalent), 0),
    [filtered]
  )

  const selectedCurrencyRate = currencies.find((c) => c.code === form.currencyCode)?.rate ?? 1
  const previewMonthly = form.amount && form.frequency
    ? calcMonthly((parseFloat(form.amount) || 0) * selectedCurrencyRate, form.frequency)
    : null
  const isForeignCurrency = form.currencyCode !== baseCurrency

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createYearMutation = useMutation({
    mutationFn: () =>
      api.post<BudgetYear>(`/households/${householdId}/budget-years`, {
        year: new Date().getFullYear(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget-years', householdId] }),
  })

  const createMutation = useMutation({
    mutationFn: (data: ExpenseForm & { frequencyPeriod?: string; notes?: string }) =>
      api.post<Expense>(`/budget-years/${activeBudgetYear!.id}/expenses`, {
        ...data,
        amount: parseFloat(data.amount),
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', activeBudgetYear?.id] })
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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', activeBudgetYear?.id] })
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
    mutationFn: (id: string) =>
      api.delete(`/budget-years/${activeBudgetYear!.id}/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', activeBudgetYear?.id] })
      setDeleteTarget(null)
      toast.success('Expense deleted')
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openAdd() {
    setForm(emptyForm(baseCurrency))
    setFormError('')
    setShowAdd(true)
  }

  function openEdit(expense: Expense) {
    setForm({
      label: expense.label,
      amount: expense.originalAmount ?? expense.amount,
      frequency: expense.frequency,
      categoryId: expense.category.id,
      frequencyPeriod: expense.frequencyPeriod ?? '',
      notes: expense.notes ?? '',
      currencyCode: expense.currencyCode ?? baseCurrency,
    })
    setFormError('')
    setEditingExpense(expense)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const payload = {
      ...form,
      frequencyPeriod: form.frequencyPeriod || undefined,
      notes: form.notes || undefined,
    } as ExpenseForm
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

  return (
    <>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <PageHeader title="Expenses" />
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
          </div>
        )}

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
              <div className="flex items-center justify-between gap-4">
                <CategoryFilter
                  categories={categories}
                  selected={filterCategories}
                  onChange={setFilterCategories}
                />
                <button
                  onClick={openAdd}
                  className="flex-shrink-0 bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  + Add expense
                </button>
              </div>
            </div>

            {/* Table */}
            {expensesLoading ? (
              <PageLoader />
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                {expenses.length === 0 ? 'No plunder recorded yet. Add one to get started.' : 'No plunder matches the filter.'}
              </div>
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-left select-none">
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
                      <th className="px-4 py-3 sr-only">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group">
                        <td className="px-4 py-3 text-white">
                          {e.label}
                          {e.notes && (
                            <span className="ml-2 text-gray-600 text-xs" title={e.notes}>📝</span>
                          )}
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
                          {fmt(parseFloat(e.originalAmount ?? e.amount))}
                          {e.currencyCode && (
                            <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-400 tabular-nums font-medium">
                          {fmt(parseFloat(e.monthlyEquivalent))}
                          <span className="ml-1 text-xs text-gray-500">{baseCurrency}</span>
                        </td>
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
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 bg-gray-800/50">
                      <td colSpan={4} className="px-4 py-3 text-sm text-gray-400 font-medium">
                        Total{filterCategories.size > 0 ? ' (filtered)' : ''} — {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">
                        {fmt(totalMonthly)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {/* Add / Edit modal */}
      {(showAdd || editingExpense) && (
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
                  <span className="text-amber-400 font-medium">{fmt(previewMonthly)} {baseCurrency}</span>
                  {isForeignCurrency && form.amount && (
                    <span className="ml-2 text-gray-600">
                      ({fmt(parseFloat(form.amount))} {form.currencyCode} × {selectedCurrencyRate.toFixed(4)})
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
                  {isMutating ? 'Saving…' : editingExpense ? 'Save changes' : 'Add expense'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setEditingExpense(null) }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal title="Delete expense" onClose={() => setDeleteTarget(null)} size="sm">
          <p className="text-gray-300 text-sm mb-1">
            Are you sure you want to delete <span className="text-white font-medium">"{deleteTarget.label}"</span>?
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
