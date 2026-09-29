import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { Plus, Pencil, Trash } from 'lucide-react'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { Account, AccountForm } from '../../api/types'
import { PageLoader } from '../../components/LoadingSpinner'
import { AccountFormModal, DeleteAccountDialog } from '../../components/accounts/AccountDialogs'
import { ACCOUNT_TYPE_LABELS } from '../../lib/constants'
import { cardClass } from './cardClass'

// ── Tab 3: Accounts ──────────────────────────────────────────────────────────

function emptyAccountForm(): AccountForm {
  return { name: '', type: 'BANK' }
}

export function AccountsTab() {
  const queryClient = useQueryClient()

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: qk.accountsPersonal(),
    queryFn: async () => (await api.get<Account[]>('/users/me/accounts')).data,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [form, setForm] = useState<AccountForm>(emptyAccountForm())
  const [formError, setFormError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  function openAdd() {
    setForm(emptyAccountForm())
    setFormError('')
    setShowAdd(true)
  }

  function openEdit(account: Account) {
    setForm({ name: account.name, type: account.type })
    setFormError('')
    setEditingAccount(account)
  }

  function closeModal() {
    setShowAdd(false)
    setEditingAccount(null)
    setForm(emptyAccountForm())
    setFormError('')
  }

  const createMutation = useMutation({
    mutationFn: (data: AccountForm) => api.post('/users/me/accounts', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsPersonal() })
      closeModal()
      toast.success('Account added')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: AccountForm) => api.put(`/users/me/accounts/${editingAccount!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsPersonal() })
      closeModal()
      toast.success('Account updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/users/me/accounts/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsPersonal() })
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to update')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsPersonal() })
      setDeleteTarget(null)
      setDeleteError('')
      toast.success('Account deleted')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setDeleteError((err.response?.data as { error?: string })?.error ?? 'Failed to delete')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) { setFormError('Name is required'); return }
    if (editingAccount) updateMutation.mutate(form)
    else createMutation.mutate(form)
  }

  const isMutating = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Personal accounts</h2>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <Plus size={14} /> Add account
          </button>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : accounts.length === 0 ? (
          <p className="text-sm text-gray-500">No accounts yet. Add one to start tagging expenses and savings.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 border border-gray-600">
                    {ACCOUNT_TYPE_LABELS[account.type]}
                  </span>
                  <span className={`text-sm font-medium ${account.isActive ? 'text-white' : 'text-gray-500 line-through'}`}>
                    {account.name}
                  </span>
                  {!account.isActive && (
                    <span className="text-xs text-gray-600">inactive</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: account.id, isActive: !account.isActive })}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {account.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => openEdit(account)}
                    className="text-gray-500 hover:text-gray-300 transition-colors p-1"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(account); setDeleteError('') }}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {(showAdd || editingAccount) && (
        <AccountFormModal
          isEditing={!!editingAccount}
          form={form}
          setForm={setForm}
          error={formError}
          pending={isMutating}
          onSubmit={handleSubmit}
          onClose={closeModal}
          placeholder="e.g. Main bank account"
          labelClassName="block text-xs font-medium text-gray-400 mb-1"
          actionsClassName="flex gap-3"
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteAccountDialog
          account={deleteTarget}
          error={deleteError}
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => { setDeleteTarget(null); setDeleteError('') }}
        />
      )}
    </div>
  )
}
