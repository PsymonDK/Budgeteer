import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { CategoryIcon } from '../components/CategoryIcon'
import { IconPicker } from '../components/IconPicker'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass, primaryBtn, secondaryBtn, dangerBtn, primaryBtnSm } from '../lib/styles'
import { getApiError } from '../lib/apiError'
import type { Category } from '../api/types'
import { qk } from '../api/queryKeys'
import { useCategories, useHouseholdDetail } from '../api/queries'
import { FormError } from '../components/FormError'
import { Page } from '../components/Page'

export function CategoriesPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState<'EXPENSE' | 'SAVINGS'>('EXPENSE')
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState<string | null>(null)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createWarning, setCreateWarning] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [replacementId, setReplacementId] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const { data: household } = useHouseholdDetail(householdId)

  const { data: categories = [], isLoading } = useCategories(householdId)

  const isHouseholdAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'
  const isSystemAdmin = me?.role === 'SYSTEM_ADMIN'

  const systemCategories = categories.filter((c) => c.isSystemWide)
  const customExpenseCategories = categories.filter((c) => !c.isSystemWide && c.categoryType === 'EXPENSE')
  const customSavingsCategories = categories.filter((c) => !c.isSystemWide && c.categoryType === 'SAVINGS')

  // Replacement targets: same type, excluding the one being deleted
  const replacementOptions = categories.filter(
    (c) => c.id !== deleteTarget?.id && c.categoryType === deleteTarget?.categoryType
  )

  const createMutation = useMutation({
    mutationFn: ({ name, icon, categoryType }: { name: string; icon: string | null; categoryType: 'EXPENSE' | 'SAVINGS' }) =>
      api.post<Category & { warning?: string }>('/categories', { name, householdId, categoryType, ...(icon ? { icon } : {}) }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.categories(householdId) })
      setShowCreate(false)
      setNewName('')
      setNewIcon(null)
      setShowIconPicker(false)
      setCreateError('')
      if (res.data.warning) setCreateWarning(res.data.warning)
      toast.success('Category created')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setCreateError((err.response?.data as { error?: string })?.error ?? 'Failed to create category')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id, repId }: { id: string; repId?: string }) => {
      const totalInUse = (deleteTarget?._count.expenses ?? 0) + (deleteTarget?._count.savingsEntries ?? 0)
      return api.delete(`/categories/${id}`, totalInUse > 0 && repId ? { data: { replacementId: repId } } : undefined)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.categories(householdId) })
      setDeleteTarget(null)
      setReplacementId('')
      setDeleteError('')
      toast.success('Category deleted')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setDeleteError((err.response?.data as { error?: string })?.error ?? 'Failed to delete category')
      }
    },
  })

  const promoteMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to promote category')),
    mutationFn: (id: string) => api.post(`/categories/${id}/promote`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.categories(householdId) }),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreateWarning('')
    createMutation.mutate({ name: newName, icon: newIcon, categoryType: createType })
  }

  function openCreate(type: 'EXPENSE' | 'SAVINGS') {
    setCreateType(type)
    setNewName('')
    setNewIcon(null)
    setShowIconPicker(false)
    setCreateError('')
    setCreateWarning('')
    setShowCreate(true)
  }

  function handleDelete(e: FormEvent) {
    e.preventDefault()
    if (!deleteTarget) return
    setDeleteError('')
    const totalInUse = deleteTarget._count.expenses + deleteTarget._count.savingsEntries
    deleteMutation.mutate({
      id: deleteTarget.id,
      repId: totalInUse > 0 ? replacementId : undefined,
    })
  }

  return (
    <>
      <Page template="list">
        <PageHeader title="Categories" />
        {createWarning && (
          <div className="mb-6 bg-amber-950 border border-amber-700 text-amber-300 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
            <span>{createWarning}</span>
            <button onClick={() => setCreateWarning('')} className="text-amber-500 hover:text-amber-300 ml-4">×</button>
          </div>
        )}

        {/* Custom expense categories */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Custom expense categories</h2>
            {isHouseholdAdmin && (
              <button
                onClick={() => openCreate('EXPENSE')}
                className={primaryBtnSm}
              >
                + New category
              </button>
            )}
          </div>

          {isLoading ? (
            <PageLoader />
          ) : customExpenseCategories.length === 0 ? (
            <p className="text-gray-500 text-sm">Uncharted territory — no custom expense categories yet.</p>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Created by</th>
                    <th className="px-4 py-3 font-medium">In use</th>
                    <th className="relative px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {customExpenseCategories.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3 text-white font-medium">
                        <span className="flex items-center gap-2">
                          {c.icon && <CategoryIcon name={c.icon} size={16} className="text-gray-400 shrink-0" />}
                          {c.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{c.createdBy.name}</td>
                      <td className="px-4 py-3 text-gray-400">{c._count.expenses}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {isSystemAdmin && (
                            <button
                              onClick={() => promoteMutation.mutate(c.id)}
                              disabled={promoteMutation.isPending}
                              className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                            >
                              Promote
                            </button>
                          )}
                          {isHouseholdAdmin && (
                            <button
                              onClick={() => { setDeleteTarget(c); setReplacementId(''); setDeleteError('') }}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>

        {/* Custom savings categories */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Custom savings categories</h2>
            {isHouseholdAdmin && (
              <button
                onClick={() => openCreate('SAVINGS')}
                className={primaryBtnSm}
              >
                + New category
              </button>
            )}
          </div>

          {isLoading ? (
            <PageLoader />
          ) : customSavingsCategories.length === 0 ? (
            <p className="text-gray-500 text-sm">No custom savings categories yet.</p>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Created by</th>
                    <th className="px-4 py-3 font-medium">In use</th>
                    <th className="relative px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {customSavingsCategories.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3 text-white font-medium">
                        <span className="flex items-center gap-2">
                          {c.icon && <CategoryIcon name={c.icon} size={16} className="text-gray-400 shrink-0" />}
                          {c.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{c.createdBy.name}</td>
                      <td className="px-4 py-3 text-gray-400">{c._count.savingsEntries}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {isSystemAdmin && (
                            <button
                              onClick={() => promoteMutation.mutate(c.id)}
                              disabled={promoteMutation.isPending}
                              className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                            >
                              Promote
                            </button>
                          )}
                          {isHouseholdAdmin && (
                            <button
                              onClick={() => { setDeleteTarget(c); setReplacementId(''); setDeleteError('') }}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>

        {/* System-wide categories */}
        <div>
          <h2 className="text-lg font-semibold mb-4">System categories</h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">In use</th>
                  {isSystemAdmin && <th className="relative px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {systemCategories.map((c) => (
                  <tr key={c.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-white">
                      <span className="flex items-center gap-2">
                        {c.icon && <CategoryIcon name={c.icon} size={16} className="text-gray-400 shrink-0" />}
                        {c.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.categoryType === 'SAVINGS'
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : 'bg-gray-800 text-gray-400'
                      }`}>
                        {c.categoryType === 'SAVINGS' ? 'Savings' : 'Expense'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {c.categoryType === 'SAVINGS' ? c._count.savingsEntries : c._count.expenses}
                    </td>
                    {isSystemAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => { setDeleteTarget(c); setReplacementId(''); setDeleteError('') }}
                          className="text-xs text-red-500 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </Page>

      {/* Create category modal */}
      {showCreate && (
        <Modal title={`New custom ${createType === 'SAVINGS' ? 'savings' : 'expense'} category`} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                autoFocus
                className={inputClass}
                placeholder="e.g. Pet expenses"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Icon <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                {newIcon ? (
                  <span className="flex items-center gap-2 text-sm text-gray-300">
                    <CategoryIcon name={newIcon} size={16} className="text-amber-400" />
                    {newIcon}
                  </span>
                ) : (
                  <span className="text-sm text-gray-600">None selected</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowIconPicker((v) => !v)}
                  className="ml-auto text-xs text-amber-400 hover:text-amber-300 transition-colors"
                >
                  {showIconPicker ? 'Close' : newIcon ? 'Change' : 'Pick icon'}
                </button>
              </div>
              {showIconPicker && (
                <IconPicker
                  value={newIcon}
                  onChange={setNewIcon}
                  onClose={() => setShowIconPicker(false)}
                />
              )}
            </div>
            <FormError message={createError} />
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className={`flex-1 ${primaryBtn}`}
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className={`flex-1 ${secondaryBtn}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete / reassign modal */}
      {deleteTarget && (
        <Modal title={`Delete "${deleteTarget.name}"`} onClose={() => setDeleteTarget(null)}>
          <form onSubmit={handleDelete} className="space-y-4">
            {(() => {
              const totalInUse = deleteTarget._count.expenses + deleteTarget._count.savingsEntries
              const entryLabel = deleteTarget.categoryType === 'SAVINGS' ? 'savings entries' : 'expenses'
              return totalInUse > 0 ? (
                <>
                  <p className="text-sm text-gray-300">
                    This category is used by{' '}
                    <span className="text-white font-medium">{totalInUse}</span>{' '}
                    {totalInUse === 1 ? entryLabel.slice(0, -1) : entryLabel}.
                    Choose a replacement category before deleting.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Reassign to</label>
                    <select
                      value={replacementId}
                      onChange={(e) => setReplacementId(e.target.value)}
                      required
                      className={inputClass}
                    >
                      <option value="">Select a category…</option>
                      {replacementOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.isSystemWide ? ' (system)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-300">
                  This category has no entries. It will be permanently deleted.
                </p>
              )
            })()}
            <FormError message={deleteError} />
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={deleteMutation.isPending || ((deleteTarget._count.expenses + deleteTarget._count.savingsEntries) > 0 && !replacementId)}
                className={`flex-1 ${dangerBtn}`}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className={`flex-1 ${secondaryBtn}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
