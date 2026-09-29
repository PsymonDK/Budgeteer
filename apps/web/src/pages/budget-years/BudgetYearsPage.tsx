import { useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useBudgetYears, useHouseholdDetail } from '../../api/queries'
import type { BudgetYear } from '../../api/types'
import { useAuth } from '../../contexts/AuthContext'
import { PageLoader } from '../../components/LoadingSpinner'
import { PageHeader } from '../../components/PageHeader'
import { primaryBtnSm } from '../../lib/styles'
import { getApiError } from '../../lib/apiError'
import { RegularYearsTable, SimulationsTable } from './BudgetYearTables'
import {
  CopyYearModal, CreateYearModal, DeleteYearDialog, NewSimulationModal, PromoteYearDialog, RenameSimulationModal,
  RetireYearDialog,
} from './BudgetYearDialogs'

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

  // New simulation modal
  const [showNewSim, setShowNewSim] = useState(false)
  const [newSimSourceId, setNewSimSourceId] = useState('')
  const [newSimName, setNewSimName] = useState('')
  const [newSimError, setNewSimError] = useState('')

  // Rename simulation modal
  const [renameTarget, setRenameTarget] = useState<BudgetYear | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')

  // Retire / promote confirm modals
  const [retireTarget, setRetireTarget] = useState<BudgetYear | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<BudgetYear | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BudgetYear | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: household } = useHouseholdDetail(householdId)

  const { data: years = [], isLoading } = useBudgetYears(householdId)

  const isAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'
  const currentYear = new Date().getFullYear()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.budgetYears(householdId) })
    queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) })
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
      setShowNewSim(false)
      setNewSimError('')
      toast.success('Budget year copied')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string })?.error ?? 'Failed to copy'
        setCopyError(msg)
        setNewSimError(msg)
      }
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
    onError: (err) => toast.error(getApiError(err, 'Failed to retire budget year')),
    mutationFn: (id: string) =>
      api.patch(`/households/${householdId}/budget-years/${id}/retire`),
    onSuccess: () => {
      invalidate()
      setRetireTarget(null)
      toast.success('Budget year retired')
    },
  })

  const promoteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to promote simulation')),
    mutationFn: (id: string) =>
      api.patch(`/households/${householdId}/budget-years/${id}/promote`),
    onSuccess: () => {
      invalidate()
      setPromoteTarget(null)
      toast.success('Budget year promoted to active')
    },
  })

  const deleteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete budget year')),
    mutationFn: (id: string) =>
      api.delete(`/households/${householdId}/budget-years/${id}`),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      toast.success('Budget year deleted')
    },
  })

  // ── Grouping ──────────────────────────────────────────────────────────────────

  const regularYears = years.filter((y) => y.status !== 'SIMULATION')
  const simulations = years.filter((y) => y.status === 'SIMULATION')

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

  function handleNewSim(e: FormEvent) {
    e.preventDefault()
    setNewSimError('')
    if (!newSimSourceId) { setNewSimError('Select a source year'); return }
    if (!newSimName.trim()) { setNewSimError('Simulation name is required'); return }
    copyMutation.mutate({ sourceId: newSimSourceId, body: { simulationName: newSimName.trim() } })
  }

  function openNewSim() {
    setNewSimSourceId(regularYears[0]?.id ?? '')
    setNewSimName('')
    setNewSimError('')
    setShowNewSim(true)
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
                  className={primaryBtnSm}
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
            <RegularYearsTable
              householdId={householdId}
              years={regularYears}
              isAdmin={isAdmin}
              currentYear={currentYear}
              onCopy={openCopy}
              onRetire={setRetireTarget}
              onPromote={setPromoteTarget}
              onDelete={setDeleteTarget}
            />

            {/* Simulations */}
            <SimulationsTable
              householdId={householdId}
              simulations={simulations}
              canCreate={regularYears.length > 0}
              onNewSimulation={openNewSim}
              onRename={openRename}
              onPromote={setPromoteTarget}
              onDelete={setDeleteTarget}
            />
          </>
        )}
      </main>

      {/* ── Create year modal ────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateYearModal
          year={createYear}
          setYear={setCreateYear}
          error={createError}
          pending={createMutation.isPending}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* ── New simulation modal ─────────────────────────────────────────────── */}
      {showNewSim && (
        <NewSimulationModal
          regularYears={regularYears}
          sourceId={newSimSourceId}
          setSourceId={setNewSimSourceId}
          name={newSimName}
          setName={setNewSimName}
          error={newSimError}
          pending={copyMutation.isPending}
          onSubmit={handleNewSim}
          onClose={() => setShowNewSim(false)}
        />
      )}

      {/* ── Copy modal ───────────────────────────────────────────────────────── */}
      {copySource && (
        <CopyYearModal
          source={copySource}
          mode={copyMode}
          setMode={setCopyMode}
          year={copyYear}
          setYear={setCopyYear}
          simName={copySimName}
          setSimName={setCopySimName}
          error={copyError}
          pending={copyMutation.isPending}
          onSubmit={handleCopy}
          onClose={() => setCopySource(null)}
        />
      )}

      {/* ── Rename simulation modal ──────────────────────────────────────────── */}
      {renameTarget && (
        <RenameSimulationModal
          value={renameValue}
          setValue={setRenameValue}
          error={renameError}
          pending={renameMutation.isPending}
          onSubmit={handleRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {/* ── Retire confirm modal ──────────────────────────────────────────────── */}
      {retireTarget && (
        <RetireYearDialog
          target={retireTarget}
          pending={retireMutation.isPending}
          onConfirm={() => retireMutation.mutate(retireTarget.id)}
          onClose={() => setRetireTarget(null)}
        />
      )}

      {/* ── Promote confirm modal ─────────────────────────────────────────────── */}
      {promoteTarget && (
        <PromoteYearDialog
          target={promoteTarget}
          currentYear={currentYear}
          pending={promoteMutation.isPending}
          onConfirm={() => promoteMutation.mutate(promoteTarget.id)}
          onClose={() => setPromoteTarget(null)}
        />
      )}

      {/* ── Delete budget year confirm modal ─────────────────────────────────── */}
      {deleteTarget && (
        <DeleteYearDialog
          target={deleteTarget}
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
