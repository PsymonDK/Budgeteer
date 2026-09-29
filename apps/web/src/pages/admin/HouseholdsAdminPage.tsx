import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import axios from 'axios'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormError } from '../../components/FormError'
import type { Household } from '../../api/types'
import { Page } from '../../components/Page'
import { PageHeader } from '../../components/PageHeader'
import { DataTable, type DataColumn } from '../../components/DataTable'

export function HouseholdsAdminPage() {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState<Household | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: qk.householdsAdmin(),
    queryFn: async () => (await api.get<Household[]>('/households?all=true')).data,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/households/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.households() })
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

  const adminNames = (h: Household) => h.members.filter((m) => m.role === 'ADMIN').map((m) => m.user.name).join(', ')
  const columns: DataColumn<Household>[] = [
    { key: 'name', header: 'Name', cell: (h) => <span className="font-medium text-white">{h.name}</span> },
    { key: 'members', header: 'Members', priority: 2, cell: (h) => <span className="text-gray-300">{h._count.members}</span>, summary: (h) => `${h._count.members} members` },
    { key: 'admins', header: 'Admins', priority: 3, cell: (h) => <span className="text-gray-300 text-xs">{adminNames(h)}</span>, summary: adminNames },
    {
      key: 'status', header: 'Status', priority: 2,
      cell: (h) => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${h.isActive ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
          {h.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
      summary: (h) => (h.isActive ? null : 'Inactive'),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: (h) => (
        <span className="inline-flex items-center justify-end gap-4">
          <Link to={`/households/${h.id}`} className="text-xs text-gray-400 hover:text-white transition-colors">View</Link>
          <button onClick={() => { setConfirmDelete(h); setDeleteError('') }} className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Delete
          </button>
        </span>
      ),
    },
  ]

  return (
    <>
      <Page template="list">
        <PageHeader title="All Households" action={<span className="text-sm text-gray-500">{households.length} total</span>} />

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : households.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No crews on the seas yet.</div>
        ) : (
          <DataTable rows={households} columns={columns} rowClassName={(h) => (h.isActive ? '' : 'opacity-50')} />
        )}
      </Page>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete household"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
          pending={deleteMutation.isPending}
          confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
        >
          <p className="text-gray-300 text-sm mb-2">
            Permanently delete <span className="font-semibold text-white">{confirmDelete.name}</span>? This cannot be undone.
          </p>
          <p className="text-gray-500 text-xs mb-6">All members, budget years, expenses, and income data will be lost.</p>
          <FormError message={deleteError} className="mb-4" />
        </ConfirmDialog>
      )}
    </>
  )
}
