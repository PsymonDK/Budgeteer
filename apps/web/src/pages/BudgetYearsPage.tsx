import { useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BudgetYear {
  id: string
  year: number
  status: 'ACTIVE' | 'FUTURE' | 'RETIRED' | 'SIMULATION'
  simulationName: string | null
  copiedFromId: string | null
  _count: { expenses: number; savingsEntries: number }
}

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(by: BudgetYear) {
  if (by.status === 'ACTIVE') return 'bg-green-900/50 text-green-300'
  if (by.status === 'FUTURE') return 'bg-blue-900/50 text-blue-300'
  if (by.status === 'SIMULATION') return 'bg-purple-900/50 text-purple-300'
  return 'bg-gray-800 text-gray-500'
}

function statusLabel(by: BudgetYear) {
  if (by.status === 'SIMULATION') return by.simulationName ?? 'Simulation'
  return by.status.charAt(0) + by.status.slice(1).toLowerCase()
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BudgetYearsPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const queryClient = useQueryClient()

  // Create year modal
  const [showCreate, setShowCreate] = useState(false)
  const [createYear, setCreateYear] = useState(String(new Date().getFullYear()))
  const [createError, setCreateError] = useState('')

  // Copy modal
  const [copySource, setCopySource] = useState<BudgetYear | null>(null)
  const [copyMode, setCopyMode] = useState<'year' | 'simulation'>('year')
  const [copyYear, setCopyYear] = useState(String(new Date().getFullYear() + 1))
  const [copySimName, setCopySimName] = useState('')
  const [copyError, setCopyError] = useState('')

  // Rename simulation modal
  const [renameTarget, setRenameTarget] = useState<BudgetYear | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')

  // Retire / promote confirm modals
  const [retireTarget, setRetireTarget] = useState<BudgetYear | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<BudgetYear | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BudgetYear | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: household } = useQuery<Household>({
    queryKey: ['household', householdId],
    queryFn: async () => (await api.get<Household>(`/households/${householdId}`)).data,
    enabled: !!householdId,
  })

  const { data: years = [], isLoading } = useQuery<BudgetYear[]>({
    queryKey: ['budget-years', householdId],
    queryFn: async () => (await api.get<BudgetYear[]>(`/households/${householdId}/budget-years`)).data,
    enabled: !!householdId,
  })

  const isAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['budget-years', householdId] })
    queryClient.invalidateQueries({ queryKey: ['dashboard', householdId] })
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (year: number) =>
      api.post(`/households/${householdId}/budget-years`, { year }),
    onSuccess: () => {
      invalidate()
      setShowCreate(false)
      setCreateError('')
      toast.success('Budget year created')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setCreateError((err.response?.data as { error?: string })?.error ?? 'Failed to create')
    },
  })

  const copyMutation = useMutation({
    mutationFn: ({ sourceId, body }: { sourceId: string; body: object }) =>
      api.post(`/households/${householdId}/budget-years/${sourceId}/copy`, body),
    onSuccess: () => {
      invalidate()
      setCopySource(null)
      setCopyError('')
      toast.success('Budget year copied')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setCopyError((err.response?.data as { error?: string })?.error ?? 'Failed to copy')
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/households/${householdId}/budget-years/${id}`, { simulationName: name }),
    onSuccess: () => {
      invalidate()
      setRenameTarget(null)
      setRenameError('')
      toast.success('Budget year renamed')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) setRenameError((err.response?.data as { error?: string })?.error ?? 'Failed to rename')
    },
  })

  const retireMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/households/${householdId}/budget-years/${id}/retire`),
    onSuccess: () => {
      invalidate()
      setRetireTarget(null)
      toast.success('Budget year retired')
    },
  })

  const promoteMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/households/${householdId}/budget-years/${id}/promote`),
    onSuccess: () => {
      invalidate()
      setPromoteTarget(null)
      toast.success('Budget year promoted to active')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/households/${householdId}/budget-years/${id}`),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      toast.success('Budget year deleted')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    const y = parseInt(createYear)
    if (isNaN(y)) { setCreateError('Invalid year'); return }
    createMutation.mutate(y)
  }

  function handleCopy(e: FormEvent) {
    e.preventDefault()
    setCopyError('')
    if (!copySource) return
    if (copyMode === 'year') {
      const y = parseInt(copyYear)
      if (isNaN(y)) { setCopyError('Invalid year'); return }
      copyMutation.mutate({ sourceId: copySource.id, body: { year: y } })
    } else {
      if (!copySimName.trim()) { setCopyError('Simulation name is required'); return }
      copyMutation.mutate({ sourceId: copySource.id, body: { simulationName: copySimName.trim() } })
    }
  }

  function handleRename(e: FormEvent) {
    e.preventDefault()
    setRenameError('')
    if (!renameTarget) return
    if (!renameValue.trim()) { setRenameError('Name is required'); return }
    renameMutation.mutate({ id: renameTarget.id, name: renameValue.trim() })
  }

  function openCopy(by: BudgetYear) {
    setCopySource(by)
    setCopyMode('year')
    setCopyYear(String(by.year + 1))
    setCopySimName('')
    setCopyError('')
  }

  function openRename(by: BudgetYear) {
    setRenameTarget(by)
    setRenameValue(by.simulationName ?? '')
    setRenameError('')
  }

  // ── Grouping ──────────────────────────────────────────────────────────────────

  const regularYears = years.filter((y) => y.status !== 'SIMULATION')
  const simulations = years.filter((y) => y.status === 'SIMULATION')

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <PageHeader
          title="Budget Years"
          subtitle="Manage budget years and planning simulations."
          action={
            <div className="flex items-center gap-3">
              <Link
                to={`/households/${householdId}/compare`}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                Compare →
              </Link>
              {isAdmin && (
                <button
                  onClick={() => { setShowCreate(true); setCreateError('') }}
                  className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  + New year
                </button>
              )}
            </div>
          }
        />

        {isLoading ? (
          <PageLoader />
        ) : (
          <>
            {/* Regular budget years */}
            <section className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Budget Years</h2>
              {regularYears.length === 0 ? (
                <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
                  Your treasure chest is empty — no budget years yet.
                </div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-left">
                        <th className="px-4 py-3 font-medium">Year</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Expenses</th>
                        <th className="px-4 py-3 font-medium text-right">Savings</th>
                        {isAdmin && <th className="px-4 py-3 sr-only">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {regularYears.map((by) => (
                        <tr key={by.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                          <td className="px-4 py-3 font-medium text-white">{by.year}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadge(by)}`}>
                              {statusLabel(by)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-300">{by._count.expenses}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{by._count.savingsEntries}</td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <Link
                                  to={`/households/${householdId}/expenses?budgetYearId=${by.id}`}
                                  className="text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                  Expenses
                                </Link>
                                <button
                                  onClick={() => openCopy(by)}
                                  className="text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                  Copy
                                </button>
                                {(by.status === 'ACTIVE' || by.status === 'FUTURE') && (
                                  <button
                                    onClick={() => setRetireTarget(by)}
                                    className="text-xs text-amber-600 hover:text-amber-400 transition-colors"
                                  >
                                    Retire
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Simulations */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Simulations</h2>
              </div>
              {simulations.length === 0 ? (
                <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
                  No simulations charted. Copy a budget year and choose "Simulation" to create one.
                </div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-left">
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Year</th>
                        <th className="px-4 py-3 font-medium text-right">Expenses</th>
                        <th className="px-4 py-3 font-medium text-right">Savings</th>
                        {isAdmin && <th className="px-4 py-3 sr-only">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {simulations.map((by) => (
                        <tr key={by.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                          <td className="px-4 py-3 text-white font-medium">
                            <span className="text-purple-300">{by.simulationName ?? '—'}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-300">{by.year}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{by._count.expenses}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{by._count.savingsEntries}</td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <Link
                                  to={`/households/${householdId}/expenses?budgetYearId=${by.id}`}
                                  className="text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                  Expenses
                                </Link>
                                <button
                                  onClick={() => openRename(by)}
                                  className="text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => setPromoteTarget(by)}
                                  className="text-xs text-green-600 hover:text-green-400 transition-colors"
                                >
                                  Promote
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(by)}
                                  className="text-xs text-red-600 hover:text-red-400 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* ── Create year modal ────────────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="New budget year" onClose={() => setShowCreate(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
              <input
                type="number"
                value={createYear}
                onChange={(e) => setCreateYear(e.target.value)}
                min="2000"
                max="2100"
                required
                autoFocus
                className={inputClass}
              />
            </div>
            {createError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{createError}</div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Copy modal ───────────────────────────────────────────────────────── */}
      {copySource && (
        <Modal
          title={`Copy ${copySource.year}${copySource.simulationName ? ` — ${copySource.simulationName}` : ''}`}
          onClose={() => setCopySource(null)}
        >
          <p className="text-gray-400 text-sm mb-4">Copies all expenses and savings entries. Income allocations are not copied.</p>
          <form onSubmit={handleCopy} className="space-y-4">
            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm font-medium">
              <button
                type="button"
                onClick={() => setCopyMode('year')}
                className={`flex-1 px-4 py-2.5 transition-colors ${copyMode === 'year' ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`}
              >
                New year
              </button>
              <button
                type="button"
                onClick={() => setCopyMode('simulation')}
                className={`flex-1 px-4 py-2.5 transition-colors ${copyMode === 'simulation' ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`}
              >
                Simulation
              </button>
            </div>

            {copyMode === 'year' ? (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Target year</label>
                <input
                  type="number"
                  value={copyYear}
                  onChange={(e) => setCopyYear(e.target.value)}
                  min="2000"
                  max="2100"
                  required
                  autoFocus
                  className={inputClass}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Simulation name</label>
                <input
                  type="text"
                  value={copySimName}
                  onChange={(e) => setCopySimName(e.target.value)}
                  required
                  autoFocus
                  placeholder="e.g. No car scenario"
                  className={inputClass}
                />
              </div>
            )}

            {copyError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{copyError}</div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={copyMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {copyMutation.isPending ? 'Copying…' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setCopySource(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Rename simulation modal ──────────────────────────────────────────── */}
      {renameTarget && (
        <Modal title="Rename simulation" onClose={() => setRenameTarget(null)} size="sm">
          <form onSubmit={handleRename} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                required
                autoFocus
                className={inputClass}
              />
            </div>
            {renameError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{renameError}</div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={renameMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {renameMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Retire confirm modal ──────────────────────────────────────────────── */}
      {retireTarget && (
        <Modal title={`Retire ${retireTarget.year}?`} onClose={() => setRetireTarget(null)} size="sm">
          <p className="text-gray-300 text-sm mb-1">This budget year will become read-only.</p>
          <p className="text-gray-500 text-xs mb-6">Expenses and savings data is preserved.</p>
          <div className="flex gap-3">
            <button
              onClick={() => retireMutation.mutate(retireTarget.id)}
              disabled={retireMutation.isPending}
              className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {retireMutation.isPending ? 'Retiring…' : 'Retire'}
            </button>
            <button
              onClick={() => setRetireTarget(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Promote confirm modal ─────────────────────────────────────────────── */}
      {promoteTarget && (
        <Modal title="Promote to active?" onClose={() => setPromoteTarget(null)} size="sm">
          <p className="text-gray-300 text-sm mb-1">
            <span className="text-purple-300 font-medium">"{promoteTarget.simulationName}"</span> will become the active budget for {promoteTarget.year}.
          </p>
          <p className="text-gray-500 text-xs mb-6">The current active budget year will be automatically retired.</p>
          <div className="flex gap-3">
            <button
              onClick={() => promoteMutation.mutate(promoteTarget.id)}
              disabled={promoteMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {promoteMutation.isPending ? 'Promoting…' : 'Promote'}
            </button>
            <button
              onClick={() => setPromoteTarget(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Delete simulation confirm modal ───────────────────────────────────── */}
      {deleteTarget && (
        <Modal title="Delete simulation?" onClose={() => setDeleteTarget(null)} size="sm">
          <p className="text-gray-300 text-sm mb-1">
            <span className="text-purple-300 font-medium">"{deleteTarget.simulationName}"</span> and all its expenses will be permanently deleted.
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
