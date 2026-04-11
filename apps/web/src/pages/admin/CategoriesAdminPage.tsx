import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil } from 'lucide-react'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'

interface Category {
  id: string
  name: string
  icon: string | null
  categoryType: 'EXPENSE' | 'SAVINGS'
  isSystemWide: boolean
  isActive: boolean
  householdId: string | null
  createdBy: { id: string; name: string }
  _count: { expenses: number; savingsEntries: number }
}

type TabType = 'system' | 'custom'

export function CategoriesAdminPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabType>('system')
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Category | null>(null)

  // Add form state
  const [addName, setAddName] = useState('')
  const [addType, setAddType] = useState<'EXPENSE' | 'SAVINGS'>('EXPENSE')

  // Edit form state
  const [editName, setEditName] = useState('')

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['categories', 'admin'],
    queryFn: async () => (await api.get<Category[]>('/categories')).data,
  })

  const systemCategories = categories.filter((c) => c.isSystemWide)
  const customCategories = categories.filter((c) => !c.isSystemWide)

  const addMutation = useMutation({
    mutationFn: (body: { name: string; categoryType: 'EXPENSE' | 'SAVINGS' }) =>
      api.post('/admin/categories', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', 'admin'] })
      toast.success('Category created')
      setAddOpen(false)
      setAddName('')
      setAddType('EXPENSE')
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? 'Failed to create category')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; isActive?: boolean } }) =>
      api.patch(`/admin/categories/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', 'admin'] })
      toast.success('Category updated')
      setEditTarget(null)
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? 'Failed to update category')
    },
  })

  const promoteMutation = useMutation({
    mutationFn: (id: string) => api.post(`/categories/${id}/promote`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', 'admin'] })
      toast.success('Category promoted to system-wide')
    },
    onError: () => toast.error('Failed to promote category'),
  })

  function openEdit(c: Category) {
    setEditTarget(c)
    setEditName(c.name)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    addMutation.mutate({ name: addName.trim(), categoryType: addType })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const body: { name?: string } = {}
    if (editName.trim() && editName.trim() !== editTarget.name) body.name = editName.trim()
    if (Object.keys(body).length === 0) { setEditTarget(null); return }
    updateMutation.mutate({ id: editTarget.id, body })
  }

  function toggleActive(c: Category) {
    updateMutation.mutate({ id: c.id, body: { isActive: !c.isActive } })
  }

  const tabBtn = (active: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
    }`

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage system-wide categories available to all households.
          </p>
        </div>
        {tab === 'system' && (
          <button onClick={() => setAddOpen(true)} className={`${primaryBtn} flex items-center gap-2`}>
            <Plus size={14} />
            Add category
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button className={tabBtn(tab === 'system')} onClick={() => setTab('system')}>
          System-wide ({systemCategories.length})
        </button>
        <button className={tabBtn(tab === 'custom')} onClick={() => setTab('custom')}>
          Custom ({customCategories.length})
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : tab === 'system' ? (
        <SystemCategoryTable
          categories={systemCategories}
          onEdit={openEdit}
          onToggleActive={toggleActive}
          isPending={updateMutation.isPending}
        />
      ) : (
        <CustomCategoryTable
          categories={customCategories}
          onPromote={(id) => promoteMutation.mutate(id)}
          isPending={promoteMutation.isPending}
        />
      )}

      {/* Add modal */}
      {addOpen && (
        <Modal title="Add system category" onClose={() => setAddOpen(false)} size="sm">
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                className={inputClass}
                placeholder="e.g. Entertainment"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Type</label>
              <select
                className={inputClass}
                value={addType}
                onChange={(e) => setAddType(e.target.value as 'EXPENSE' | 'SAVINGS')}
              >
                <option value="EXPENSE">Expense</option>
                <option value="SAVINGS">Savings</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setAddOpen(false)} className={secondaryBtn}>
                Cancel
              </button>
              <button type="submit" disabled={addMutation.isPending} className={primaryBtn}>
                {addMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal title="Rename category" onClose={() => setEditTarget(null)} size="sm">
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                className={inputClass}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditTarget(null)} className={secondaryBtn}>
                Cancel
              </button>
              <button type="submit" disabled={updateMutation.isPending} className={primaryBtn}>
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function SystemCategoryTable({
  categories,
  onEdit,
  onToggleActive,
  isPending,
}: {
  categories: Category[]
  onEdit: (c: Category) => void
  onToggleActive: (c: Category) => void
  isPending: boolean
}) {
  if (categories.length === 0) {
    return <div className="text-center py-20 text-gray-500">No system categories found.</div>
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">In use</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr
              key={c.id}
              className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 ${!c.isActive ? 'opacity-50' : ''}`}
            >
              <td className="px-4 py-3 text-white font-medium">{c.name}</td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  c.categoryType === 'SAVINGS'
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-gray-800 text-gray-400'
                }`}>
                  {c.categoryType === 'SAVINGS' ? 'Savings' : 'Expense'}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-400">{c._count.expenses + c._count.savingsEntries}</td>
              <td className="px-4 py-3">
                {c.isActive ? (
                  <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full">Active</span>
                ) : (
                  <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => onEdit(c)}
                    className="text-gray-400 hover:text-white transition-colors"
                    aria-label={`Rename ${c.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => onToggleActive(c)}
                    disabled={isPending}
                    className={`text-xs transition-colors disabled:opacity-40 ${
                      c.isActive
                        ? 'text-gray-500 hover:text-red-400'
                        : 'text-gray-500 hover:text-emerald-400'
                    }`}
                  >
                    {c.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function CustomCategoryTable({
  categories,
  onPromote,
  isPending,
}: {
  categories: Category[]
  onPromote: (id: string) => void
  isPending: boolean
}) {
  if (categories.length === 0) {
    return <div className="text-center py-20 text-gray-500">No custom household categories yet.</div>
  }

  return (
    <>
      <p className="text-sm text-gray-400 mb-4">
        Promote a household category to make it available to all households as a system-wide category.
      </p>
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-left">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Created by</th>
              <th className="px-4 py-3 font-medium">In use</th>
              <th className="px-4 py-3 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    c.categoryType === 'SAVINGS'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {c.categoryType === 'SAVINGS' ? 'Savings' : 'Expense'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{c.createdBy.name}</td>
                <td className="px-4 py-3 text-gray-400">{c._count.expenses + c._count.savingsEntries}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onPromote(c.id)}
                    disabled={isPending}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                  >
                    Promote to system-wide
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}
