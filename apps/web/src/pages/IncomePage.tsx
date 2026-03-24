import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────

type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL'

interface Allocation {
  id: string
  incomeEntryId: string
  budgetYearId: string
  allocationPct: string
  budgetYear: {
    id: string
    year: number
    status: string
    household: { id: string; name: string }
  }
}

interface IncomeEntry {
  id: string
  label: string
  amount: string
  frequency: Frequency
  frequencyPeriod: string | null
  monthlyEquivalent: string
  allocations: Allocation[]
  totalAllocatedPct: number
  overAllocated: boolean
}

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
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

function fmt(v: number | string) {
  return Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors text-sm'

// ── Component ─────────────────────────────────────────────────────────────────

interface IncomeForm {
  label: string
  amount: string
  frequency: Frequency
  frequencyPeriod: string
}

const emptyForm: IncomeForm = { label: '', amount: '', frequency: 'MONTHLY', frequencyPeriod: '' }

export function IncomePage() {
  const { user: me, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showAdd, setShowAdd] = useState(false)
  const [editingEntry, setEditingEntry] = useState<IncomeEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<IncomeEntry | null>(null)
  const [form, setForm] = useState<IncomeForm>(emptyForm)
  const [formError, setFormError] = useState('')

  // Allocation editing: track pending changes before saving
  const [pendingAllocations, setPendingAllocations] = useState<Record<string, string>>({})
  const [allocError, setAllocError] = useState('')

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: entries = [], isLoading } = useQuery<IncomeEntry[]>({
    queryKey: ['income'],
    queryFn: async () => (await api.get<IncomeEntry[]>('/income')).data,
  })

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  const anyOverAllocated = entries.some((e) => e.overAllocated)

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: IncomeForm) =>
      api.post<IncomeEntry>('/income', { ...data, amount: parseFloat(data.amount), frequencyPeriod: data.frequencyPeriod || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['income'] })
      setShowAdd(false)
      setForm(emptyForm)
      setFormError('')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: IncomeForm) =>
      api.put<IncomeEntry>(`/income/${editingEntry!.id}`, { ...data, amount: parseFloat(data.amount), frequencyPeriod: data.frequencyPeriod || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['income'] })
      setEditingEntry(null)
      setForm(emptyForm)
      setFormError('')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/income/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['income'] })
      setDeleteTarget(null)
    },
  })

  const allocMutation = useMutation({
    mutationFn: ({ entryId, householdId, pct }: { entryId: string; householdId: string; pct: number }) =>
      pct === 0
        ? api.delete(`/income/${entryId}/allocations/${householdId}`)
        : api.put(`/income/${entryId}/allocations/${householdId}`, { allocationPct: pct }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['income'] })
      setPendingAllocations({})
      setAllocError('')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setAllocError((err.response?.data as { error?: string })?.error ?? 'Failed to save allocation')
    },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getAllocationPct(entry: IncomeEntry, householdId: string): string {
    const key = `${entry.id}:${householdId}`
    if (key in pendingAllocations) return pendingAllocations[key]
    const alloc = entry.allocations.find((a) => a.budgetYear.household.id === householdId)
    return alloc ? alloc.allocationPct : '0'
  }

  function setPending(entryId: string, householdId: string, value: string) {
    setPendingAllocations((prev) => ({ ...prev, [`${entryId}:${householdId}`]: value }))
  }

  function saveAllocations(entry: IncomeEntry) {
    setAllocError('')
    const dirty = Object.entries(pendingAllocations)
      .filter(([key]) => key.startsWith(`${entry.id}:`))

    if (dirty.length === 0) return

    for (const [key, value] of dirty) {
      const householdId = key.split(':')[1]
      allocMutation.mutate({ entryId: entry.id, householdId, pct: parseFloat(value) || 0 })
    }
  }

  function openEdit(entry: IncomeEntry) {
    setForm({ label: entry.label, amount: entry.amount, frequency: entry.frequency, frequencyPeriod: entry.frequencyPeriod ?? '' })
    setFormError('')
    setEditingEntry(entry)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (editingEntry) updateMutation.mutate(form)
    else createMutation.mutate(form)
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const isMutating = createMutation.isPending || updateMutation.isPending

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-amber-400 font-bold text-lg hover:text-amber-300 transition-colors">☠️ Budgeteer</Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400 text-sm">My Income</span>
        </div>
        <div className="flex items-center gap-4">
          {me?.role === 'SYSTEM_ADMIN' && (
            <Link to="/admin/users" className="text-sm text-gray-400 hover:text-white transition-colors">Users</Link>
          )}
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition-colors">Sign out</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Over-allocation warning */}
        {anyOverAllocated && (
          <div className="mb-6 bg-amber-950 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300">
            ⚠ You've allocated more than 100% of one or more income sources across households. Check the allocations below.
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">My Income</h1>
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setFormError('') }}
            className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + Add income
          </button>
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-2">No income entries yet</p>
            <p className="text-sm">Add an income source to start allocating to households.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => (
              <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                {/* Entry header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-white font-semibold text-lg">{entry.label}</h2>
                    <p className="text-gray-400 text-sm mt-0.5">
                      {fmt(entry.amount)} · {FREQUENCIES.find((f) => f.value === entry.frequency)?.label}
                      {entry.frequencyPeriod && <span className="text-gray-500 ml-1">({entry.frequencyPeriod})</span>}
                    </p>
                    <p className="text-amber-400 text-sm font-medium mt-0.5">
                      {fmt(entry.monthlyEquivalent)} / month
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.overAllocated && (
                      <span className="text-xs text-amber-400 bg-amber-950 border border-amber-800 px-2 py-1 rounded">
                        &gt;100% allocated
                      </span>
                    )}
                    <button onClick={() => openEdit(entry)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                    <button onClick={() => setDeleteTarget(entry)} className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                  </div>
                </div>

                {/* Allocations */}
                {households.length > 0 && (
                  <div className="border-t border-gray-800 pt-4">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                      Household allocations <span className="normal-case text-gray-600">(total: {entry.totalAllocatedPct.toFixed(0)}%)</span>
                    </p>
                    <div className="space-y-2">
                      {households.map((h) => {
                        const pctStr = getAllocationPct(entry, h.id)
                        const pct = parseFloat(pctStr) || 0
                        const monthly = parseFloat(entry.monthlyEquivalent) * pct / 100
                        return (
                          <div key={h.id} className="flex items-center gap-3">
                            <span className="text-sm text-gray-300 w-40 truncate">{h.name}</span>
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="number"
                                value={pctStr}
                                onChange={(e) => setPending(entry.id, h.id, e.target.value)}
                                min="0"
                                max="100"
                                step="1"
                                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums"
                              />
                              <span className="text-gray-500 text-sm">%</span>
                              {pct > 0 && (
                                <span className="text-gray-400 text-xs tabular-nums">
                                  = {fmt(monthly)} / mo
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {Object.keys(pendingAllocations).some((k) => k.startsWith(`${entry.id}:`)) && (
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          onClick={() => saveAllocations(entry)}
                          disabled={allocMutation.isPending}
                          className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5 rounded transition-colors"
                        >
                          {allocMutation.isPending ? 'Saving…' : 'Save allocations'}
                        </button>
                        <button
                          onClick={() => setPendingAllocations((p) => {
                            const next = { ...p }
                            Object.keys(next).filter((k) => k.startsWith(`${entry.id}:`)).forEach((k) => delete next[k])
                            return next
                          })}
                          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          Discard
                        </button>
                        {allocError && <span className="text-red-400 text-xs">{allocError}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add / Edit modal */}
      {(showAdd || editingEntry) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editingEntry ? 'Edit income' : 'Add income'}</h2>
              <button onClick={() => { setShowAdd(false); setEditingEntry(null) }} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
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
                  placeholder="e.g. Salary, Freelance"
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
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Frequency period <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.frequencyPeriod}
                  onChange={(e) => setForm({ ...form, frequencyPeriod: e.target.value })}
                  placeholder="e.g. last day of month"
                  className={inputClass}
                />
              </div>
              {formError && (
                <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{formError}</div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={isMutating} className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                  {isMutating ? 'Saving…' : editingEntry ? 'Save changes' : 'Add income'}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); setEditingEntry(null) }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete income</h2>
            <p className="text-gray-300 text-sm mb-1">
              Delete <span className="text-white font-medium">"{deleteTarget.label}"</span>?
            </p>
            <p className="text-gray-500 text-xs mb-6">All household allocations for this entry will also be removed.</p>
            <div className="flex gap-3">
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
