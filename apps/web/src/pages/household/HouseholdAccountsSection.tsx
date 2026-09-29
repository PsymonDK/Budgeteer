import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { Plus, Pencil, Trash } from 'lucide-react'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { Account, AccountForm } from '../../api/types'
import { AccountFormModal, DeleteAccountDialog } from '../../components/accounts/AccountDialogs'
import { ACCOUNT_TYPE_LABELS } from '../../lib/constants'

interface HouseholdAccountsSectionProps {
  householdId: string
  accounts: Account[]
  isAdmin: boolean
}

/** Household accounts table with add / edit / (de)activate / delete for admins. */
export function HouseholdAccountsSection({ householdId: id, accounts: householdAccounts, isAdmin }: HouseholdAccountsSectionProps) {
  const queryClient = useQueryClient()

  const [showAddAccount, setShowAddAccount] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<Account | null>(null)
  const [accountForm, setAccountForm] = useState<AccountForm>({ name: '', type: 'BANK' })
  const [accountFormError, setAccountFormError] = useState('')
  const [accountDeleteError, setAccountDeleteError] = useState('')

  const createAccountMutation = useMutation({
    mutationFn: (data: AccountForm) => api.post(`/households/${id}/accounts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsHousehold(id) })
      setShowAddAccount(false)
      setAccountForm({ name: '', type: 'BANK' })
      setAccountFormError('')
      toast.success('Account added')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setAccountFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const updateAccountMutation = useMutation({
    mutationFn: (data: AccountForm) => api.put(`/households/${id}/accounts/${editingAccount!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsHousehold(id) })
      setEditingAccount(null)
      setAccountFormError('')
      toast.success('Account updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setAccountFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save')
    },
  })

  const toggleAccountActiveMutation = useMutation({
    mutationFn: ({ accountId, isActive }: { accountId: string; isActive: boolean }) =>
      api.put(`/households/${id}/accounts/${accountId}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsHousehold(id) })
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to update')
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (accountId: string) => api.delete(`/households/${id}/accounts/${accountId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accountsHousehold(id) })
      setDeleteAccountTarget(null)
      setAccountDeleteError('')
      toast.success('Account deleted')
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        setAccountDeleteError((err.response?.data as { error?: string })?.error ?? 'Failed to delete')
    },
  })

  function handleAccountSubmit(e: FormEvent) {
    e.preventDefault()
    setAccountFormError('')
    if (!accountForm.name.trim()) { setAccountFormError('Name is required'); return }
    if (editingAccount) updateAccountMutation.mutate(accountForm)
    else createAccountMutation.mutate(accountForm)
  }

  function openEditAccount(account: Account) {
    setAccountForm({ name: account.name, type: account.type })
    setAccountFormError('')
    setEditingAccount(account)
  }

  function closeAccountModal() {
    setShowAddAccount(false)
    setEditingAccount(null)
    setAccountForm({ name: '', type: 'BANK' })
    setAccountFormError('')
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Accounts</h2>
        {isAdmin && (
          <button
            onClick={() => { setShowAddAccount(true); setAccountFormError('') }}
            className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add account
          </button>
        )}
      </div>

      {householdAccounts.length === 0 ? (
        <p className="text-sm text-gray-500">No household accounts yet.</p>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {isAdmin && <th className="px-4 py-3 font-medium sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {householdAccounts.map((account) => (
                <tr key={account.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                  <td className="px-4 py-3 text-white">
                    <span className={account.isActive ? 'text-white' : 'text-gray-500 line-through'}>
                      {account.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                      {ACCOUNT_TYPE_LABELS[account.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {account.isActive ? 'Active' : 'Inactive'}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleAccountActiveMutation.mutate({ accountId: account.id, isActive: !account.isActive })}
                          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          {account.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => openEditAccount(account)}
                          className="text-gray-500 hover:text-gray-300 transition-colors p-1"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => { setDeleteAccountTarget(account); setAccountDeleteError('') }}
                          className="text-gray-500 hover:text-red-400 transition-colors p-1"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add/Edit account modal */}
      {(showAddAccount || editingAccount) && (
        <AccountFormModal
          isEditing={!!editingAccount}
          form={accountForm}
          setForm={setAccountForm}
          error={accountFormError}
          pending={createAccountMutation.isPending || updateAccountMutation.isPending}
          onSubmit={handleAccountSubmit}
          onClose={closeAccountModal}
          placeholder="e.g. Shared current account"
          labelClassName="block text-sm font-medium text-gray-300 mb-1"
          actionsClassName="flex gap-3 pt-2"
        />
      )}

      {/* Delete account confirmation */}
      {deleteAccountTarget && (
        <DeleteAccountDialog
          account={deleteAccountTarget}
          error={accountDeleteError}
          pending={deleteAccountMutation.isPending}
          onConfirm={() => deleteAccountMutation.mutate(deleteAccountTarget.id)}
          onClose={() => { setDeleteAccountTarget(null); setAccountDeleteError('') }}
        />
      )}
    </div>
  )
}
