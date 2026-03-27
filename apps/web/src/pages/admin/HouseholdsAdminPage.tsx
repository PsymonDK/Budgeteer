import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import axios from 'axios'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'

interface Household {
  id: string
  name: string
  isActive: boolean
  _count: { members: number }
  members: Array<{
    role: 'ADMIN' | 'MEMBER'
    user: { id: string; name: string; email: string }
  }>
}

export function HouseholdsAdminPage() {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState<Household | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: ['households', 'admin'],
    queryFn: async () => (await api.get<Household[]>('/households?all=true')).data,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/households/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['households'] })
      toast.success('Household deleted')
      setConfirmDelete(null)
      setDeleteError('')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setDeleteError((err.response?.data as { error?: string })?.error ?? 'Failed to delete household')
      }
    },
  })

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">All Households</h1>
          <span className="text-sm text-gray-500">{households.length} total</span>
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : households.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No crews on the seas yet.</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Admins</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {households.map((h) => {
                  const admins = h.members.filter((m) => m.role === 'ADMIN')
                  return (
                    <tr key={h.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 ${!h.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-white">{h.name}</td>
                      <td className="px-4 py-3 text-gray-300">{h._count.members}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">
                        {admins.map((a) => a.user.name).join(', ')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${h.isActive ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                          {h.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            to={`/households/${h.id}`}
                            className="text-xs text-gray-400 hover:text-white transition-colors"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => { setConfirmDelete(h); setDeleteError('') }}
                            className="text-xs text-red-500 hover:text-red-400 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {confirmDelete && (
        <Modal title="Delete household" onClose={() => setConfirmDelete(null)} size="sm">
          <p className="text-gray-300 text-sm mb-2">
            Permanently delete <span className="font-semibold text-white">{confirmDelete.name}</span>? This cannot be undone.
          </p>
          <p className="text-gray-500 text-xs mb-6">All members, budget years, expenses, and income data will be lost.</p>
          {deleteError && (
            <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm mb-4">{deleteError}</div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button onClick={() => setConfirmDelete(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
