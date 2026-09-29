import type { FormEvent } from 'react'
import type { BudgetYear } from '../../api/types'
import { Modal } from '../../components/Modal'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormError } from '../../components/FormError'
import { statusLabel } from '../../lib/budgetYear'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'

interface FormDialogBase {
  error: string
  pending: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}

export function CreateYearModal({ year, setYear, error, pending, onSubmit, onClose }: FormDialogBase & { year: string; setYear: (v: string) => void }) {
  return (
    <Modal title="New budget year" onClose={onClose} size="sm">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min="2000"
            max="2100"
            required
            autoFocus
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className={`flex-1 ${primaryBtn}`}
          >
            {pending ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface NewSimulationModalProps extends FormDialogBase {
  regularYears: BudgetYear[]
  sourceId: string
  setSourceId: (v: string) => void
  name: string
  setName: (v: string) => void
}

export function NewSimulationModal({ regularYears, sourceId, setSourceId, name, setName, error, pending, onSubmit, onClose }: NewSimulationModalProps) {
  return (
    <Modal title="New simulation" onClose={onClose}>
      <p className="text-gray-400 text-sm mb-4">Copies expenses and savings from an existing year into a new simulation.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Copy from</label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            required
            className={inputClass}
          >
            {regularYears.map((by) => (
              <option key={by.id} value={by.id}>
                {by.year} ({statusLabel(by.status)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Simulation name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="e.g. No car scenario"
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            {pending ? 'Creating…' : 'Create simulation'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface CopyYearModalProps extends FormDialogBase {
  source: BudgetYear
  mode: 'year' | 'simulation'
  setMode: (mode: 'year' | 'simulation') => void
  year: string
  setYear: (v: string) => void
  simName: string
  setSimName: (v: string) => void
}

export function CopyYearModal({ source: copySource, mode: copyMode, setMode: setCopyMode, year: copyYear, setYear: setCopyYear, simName: copySimName, setSimName: setCopySimName, error, pending, onSubmit, onClose }: CopyYearModalProps) {
  return (
    <Modal
      title={`Copy ${copySource.year}${copySource.simulationName ? ` — ${copySource.simulationName}` : ''}`}
      onClose={onClose}
    >
      <p className="text-gray-400 text-sm mb-4">Copies all expenses and savings entries. Income allocations are not copied.</p>
      <form onSubmit={onSubmit} className="space-y-4">
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

        <FormError message={error} />
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className={`flex-1 ${primaryBtn}`}
          >
            {pending ? 'Copying…' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function RenameSimulationModal({ value, setValue, error, pending, onSubmit, onClose }: FormDialogBase & { value: string; setValue: (v: string) => void }) {
  return (
    <Modal title="Rename simulation" onClose={onClose} size="sm">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className={`flex-1 ${primaryBtn}`}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface ConfirmBase {
  target: BudgetYear
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}

export function RetireYearDialog({ target: retireTarget, pending, onConfirm, onClose }: ConfirmBase) {
  return (
    <ConfirmDialog
      title={`Retire ${retireTarget.year}?`}
      onClose={onClose}
      onConfirm={onConfirm}
      pending={pending}
      confirmClassName="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
      confirmLabel={pending ? 'Retiring…' : 'Retire'}
    >
      <p className="text-gray-300 text-sm mb-1">This budget year will become read-only.</p>
      <p className="text-gray-500 text-xs mb-6">Expenses and savings data is preserved.</p>
    </ConfirmDialog>
  )
}

export function PromoteYearDialog({ target: promoteTarget, currentYear, pending, onConfirm, onClose }: ConfirmBase & { currentYear: number }) {
  return (
    <ConfirmDialog
      title={promoteTarget.status === 'SIMULATION' ? 'Promote to active?' : `Restore ${promoteTarget.year}?`}
      onClose={onClose}
      onConfirm={onConfirm}
      pending={pending}
      confirmClassName="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
      confirmLabel={pending ? 'Saving…' : promoteTarget.status === 'SIMULATION' ? 'Promote' : 'Restore'}
    >
      {promoteTarget.status === 'SIMULATION' ? (
        <>
          <p className="text-gray-300 text-sm mb-1">
            <span className="text-purple-300 font-medium">"{promoteTarget.simulationName}"</span> will become the active budget for {promoteTarget.year}.
          </p>
          <p className="text-gray-500 text-xs mb-6">The current active budget year will be automatically retired.</p>
        </>
      ) : (
        <>
          <p className="text-gray-300 text-sm mb-1">
            {promoteTarget.year} will become editable again as a {promoteTarget.year === currentYear ? 'current active' : 'future'} budget year.
          </p>
          <p className="text-gray-500 text-xs mb-6">
            {promoteTarget.year === currentYear
              ? 'Any other active budget year will be automatically retired.'
              : 'Past retired budget years remain protected and read-only.'}
          </p>
        </>
      )}
    </ConfirmDialog>
  )
}

export function DeleteYearDialog({ target: deleteTarget, pending, onConfirm, onClose }: ConfirmBase) {
  return (
    <ConfirmDialog
      title={deleteTarget.status === 'SIMULATION' ? 'Delete simulation?' : `Delete ${deleteTarget.year}?`}
      onClose={onClose}
      onConfirm={onConfirm}
      pending={pending}
      confirmLabel={pending ? 'Deleting…' : 'Delete'}
    >
      {deleteTarget.status === 'SIMULATION' ? (
        <p className="text-gray-300 text-sm mb-1">
          <span className="text-purple-300 font-medium">"{deleteTarget.simulationName}"</span> and all its expenses and savings will be permanently deleted.
        </p>
      ) : (
        <p className="text-gray-300 text-sm mb-1">
          {deleteTarget.year} and all its expenses, savings, income allocations, and transfers will be permanently deleted.
        </p>
      )}
      <p className="text-gray-500 text-xs mb-6">This cannot be undone.</p>
    </ConfirmDialog>
  )
}
