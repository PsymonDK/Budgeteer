import { useState, useMemo, type FormEvent } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { api } from '../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL'

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'WEEKLY',      label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'MONTHLY',     label: 'Monthly' },
  { value: 'QUARTERLY',   label: 'Quarterly' },
  { value: 'BIANNUAL',    label: 'Every 6 months' },
  { value: 'ANNUAL',      label: 'Annually' },
]

const emptyForm = (baseCurrency: string): EntryForm => ({ label: '', amount: '', frequency: 'MONTHLY', notes: '', currencyCode: baseCurrency })

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors text-sm'

function fmt(v: number | string) {
  return Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function yearLabel(y: BudgetYear) {
  if (y.status === 'SIMULATION') return `${y.year} — ${y.simulationName ?? 'Simulation'}`
  return `${y.year} (${y.status.charAt(0) + y.status.slice(1).toLowerCase()})`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SavingsPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const requestedYearId = searchParams.get('budgetYearId')
  const queryClient = useQueryClient()

  const [selectedYearId, setSelectedYearId] = useState<string | null>(requestedYearId)
  const [showAdd, setShowAdd] = useState(false)
  const [editingEntry, setEditingEntry] = useState<SavingsEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavingsEntry | null>(null)
  const [form, setForm] = useState<EntryForm>(emptyForm('DKK'))
  const [formError, setFormError] = useState('')

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

  const baseCurrency = config?.baseCurrency ?? 'DKK'

  // ── Derived ───────────────────────────────────────────────────────────────────

  const totalMonthly = useMemo(
    () => entries.reduce((s, e) => s + parseFloat(e.monthlyEquivalent), 0),
    [entries]
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
        ...data,
        amount: parseFloat(data.amount),
        notes: data.notes || undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
      }),
    onSuccess: () => { invalidate(); setShowAdd(false); setForm(emptyForm(baseCurrency)); setFormError('') },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: EntryForm) =>
      api.put(`/budget-years/${activeBudgetYear!.id}/savings/${editingEntry!.id}`, {
        ...data,
        amount: parseFloat(data.amount),
        notes: data.notes || undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
      }),
    onSuccess: () => { invalidate(); setEditingEntry(null); setForm(emptyForm(baseCurrency)); setFormError('') },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/budget-years/${activeBudgetYear!.id}/savings/${id}`),
    onSuccess: () => { invalidate(); setDeleteTarget(null) },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openAdd() { setForm(emptyForm(baseCurrency)); setFormError(''); setShowAdd(true) }

  function openEdit(e: SavingsEntry) {
    setForm({ label: e.label, amount: e.originalAmount ?? e.amount, frequency: e.frequency, notes: e.notes ?? '', currencyCode: e.currencyCode ?? baseCurrency })
    setFormError('')
    setEditingEntry(e)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (editingEntry) updateMutation.mutate(form)
    else createMutation.mutate(form)
  }

  const isMutating = createMutation.isPending || updateMutation.isPending

  // ── Render ────────────────────────────────────────────────────────────────────

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

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Savings</h1>
            <p className="text-gray-400 text-sm mt-1">
              Planned savings entries for this budget year.
            </p>
          </div>
          {!isReadOnly && activeBudgetYear && (
            <button
              onClick={openAdd}
              className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              + Add savings
            </button>
          )}
        </div>

        {yearsLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : !activeBudgetYear ? (
          <div className="text-center py-20 text-gray-500">
            <p className="mb-2">No budget year exists for this household.</p>
            <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300 text-sm">
              Go to Expenses to create one →
            </Link>
          </div>
        ) : entriesLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="mb-1">No savings entries yet.</p>
            {!isReadOnly && (
              <p className="text-sm">
                <button onClick={openAdd} className="text-amber-400 hover:text-amber-300">Add your first savings entry →</button>
              </p>
            )}
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Frequency</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">/ month</th>
                  {!isReadOnly && <th className="px-4 py-3 sr-only">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 group">
                    <td className="px-4 py-3 text-white">
                      {e.label}
                      {e.notes && <span className="ml-2 text-gray-600 text-xs" title={e.notes}>📝</span>}
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
                        <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <td colSpan={3} className="px-4 py-3 text-sm text-gray-400 font-medium">
                    Total — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-400 font-bold tabular-nums">{fmt(totalMonthly)}</td>
                  {!isReadOnly && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </main>

      {/* Add / Edit modal */}
      {(showAdd || editingEntry) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editingEntry ? 'Edit savings entry' : 'New savings entry'}</h2>
              <button
                onClick={() => { setShowAdd(false); setEditingEntry(null) }}
                className="text-gray-500 hover:text-white text-xl leading-none"
              >×</button>
            </div>
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
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete savings entry</h2>
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
          </div>
        </div>
      )}
    </>
  )
}
