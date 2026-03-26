import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { CategoryIcon } from '../components/CategoryIcon'
import { IconPicker } from '../components/IconPicker'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'

interface Category {
  id: string
  name: string
  icon: string | null
  isSystemWide: boolean
  householdId: string | null
  createdAt: string
  createdBy: { id: string; name: string }
  _count: { expenses: number }
}

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
}

export function CategoriesPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState<string | null>(null)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createWarning, setCreateWarning] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [replacementId, setReplacementId] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const { data: household } = useQuery<Household>({
    queryKey: ['household', householdId],
    queryFn: async () => (await api.get<Household>(`/households/${householdId}`)).data,
    enabled: !!householdId,
  })

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['categories', householdId],
    queryFn: async () =>
      (await api.get<Category[]>(`/categories?householdId=${householdId}`)).data,
    enabled: !!householdId,
  })

  const isHouseholdAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'
  const isSystemAdmin = me?.role === 'SYSTEM_ADMIN'

  const systemCategories = categories.filter((c) => c.isSystemWide)
  const customCategories = categories.filter((c) => !c.isSystemWide)

  // Categories available as replacement targets (excluding the one being deleted)
  const replacementOptions = categories.filter((c) => c.id !== deleteTarget?.id)

  const createMutation = useMutation({
    mutationFn: ({ name, icon }: { name: string; icon: string | null }) =>
      api.post<Category & { warning?: string }>('/categories', { name, householdId, ...(icon ? { icon } : {}) }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['categories', householdId] })
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
    mutationFn: ({ id, repId }: { id: string; repId?: string }) =>
      api.delete(`/categories/${id}`, repId ? { data: { replacementId: repId } } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', householdId] })
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
    mutationFn: (id: string) => api.post(`/categories/${id}/promote`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', householdId] }),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreateWarning('')
    createMutation.mutate({ name: newName, icon: newIcon })
  }

  function handleDelete(e: FormEvent) {
    e.preventDefault()
    if (!deleteTarget) return
    setDeleteError('')
    deleteMutation.mutate({
      id: deleteTarget.id,
      repId: deleteTarget._count.expenses > 0 ? replacementId : undefined,
    })
  }

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <PageHeader title="Categories" />
        {createWarning && (
          <div className="mb-6 bg-amber-950 border border-amber-700 text-amber-300 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
            <span>{createWarning}</span>
            <button onClick={() => setCreateWarning('')} className="text-amber-500 hover:text-amber-300 ml-4">×</button>
          </div>
        )}

        {/* Custom categories */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Custom categories</h2>
            {isHouseholdAdmin && (
              <button
                onClick={() => { setShowCreate(true); setNewIcon(null); setShowIconPicker(false); setCreateError(''); setCreateWarning('') }}
                className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
              >
                + New category
              </button>
            )}
          </div>

          {isLoading ? (
            <PageLoader />
          ) : customCategories.length === 0 ? (
            <p className="text-gray-500 text-sm">No custom categories yet.</p>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Created by</th>
                    <th className="px-4 py-3 font-medium">Expenses</th>
                    <th className="px-4 py-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customCategories.map((c) => (
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
          )}
        </div>

        {/* System-wide categories */}
        <div>
          <h2 className="text-lg font-semibold mb-4">System categories</h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Expenses</th>
                  {isSystemAdmin && <th className="px-4 py-3 font-medium sr-only">Actions</th>}
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
                    <td className="px-4 py-3 text-gray-400">{c._count.expenses}</td>
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
      </main>

      {/* Create category modal */}
      {showCreate && (
        <Modal title="New custom category" onClose={() => setShowCreate(false)}>
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
            {createError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{createError}</div>
            )}
            <div className="flex gap-3 pt-2">
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

      {/* Delete / reassign modal */}
      {deleteTarget && (
        <Modal title={`Delete "${deleteTarget.name}"`} onClose={() => setDeleteTarget(null)}>
          <form onSubmit={handleDelete} className="space-y-4">
            {deleteTarget._count.expenses > 0 ? (
              <>
                <p className="text-sm text-gray-300">
                  This category is used by{' '}
                  <span className="text-white font-medium">{deleteTarget._count.expenses}</span>{' '}
                  {deleteTarget._count.expenses === 1 ? 'expense' : 'expenses'}.
                  Choose a replacement category before deleting.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Reassign expenses to</label>
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
                This category has no expenses. It will be permanently deleted.
              </p>
            )}
            {deleteError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{deleteError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={deleteMutation.isPending || (deleteTarget._count.expenses > 0 && !replacementId)}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
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
