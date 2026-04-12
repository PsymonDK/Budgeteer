import { useState, type FormEvent } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { inputClass } from '../lib/styles'
import { type AccountType, ACCOUNT_TYPE_LABELS } from '../lib/constants'

interface Member {
  id: string
  userId: string
  role: 'ADMIN' | 'MEMBER'
  joinedAt: string
  user: { id: string; name: string; email: string; isActive: boolean; isProxy?: boolean }
}

type BudgetModel = 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'

interface Household {
  id: string
  name: string
  isActive: boolean
  autoMarkTransferPaid: boolean
  budgetModel: BudgetModel
  myRole: 'ADMIN' | 'MEMBER' | null
  members: Member[]
}

interface UserOption {
  id: string
  name: string
  email: string
  isActive: boolean
  isProxy?: boolean
}

interface HouseholdAccount {
  id: string
  name: string
  type: AccountType
  isActive: boolean
  _count: { expenses: number; savingsEntries: number }
}

interface AccountForm {
  name: string
  type: AccountType
}



export function HouseholdPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [showAddMember, setShowAddMember] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [addError, setAddError] = useState('')

  // Account state
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [editingAccount, setEditingAccount] = useState<HouseholdAccount | null>(null)
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<HouseholdAccount | null>(null)
  const [accountForm, setAccountForm] = useState<AccountForm>({ name: '', type: 'BANK' })
  const [accountFormError, setAccountFormError] = useState('')
  const [accountDeleteError, setAccountDeleteError] = useState('')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [nameError, setNameError] = useState('')

  // Confirmation dialogs
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null)
  const [confirmRoleChange, setConfirmRoleChange] = useState<{ member: Member; newRole: 'ADMIN' | 'MEMBER' } | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const { data: household, isLoading } = useQuery<Household>({
    queryKey: ['household', id],
    queryFn: async () => (await api.get<Household>(`/households/${id}`)).data,
    enabled: !!id,
  })

  // All system users — for the "add member" dropdown
  const { data: allUsers = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<UserOption[]>('/users')).data,
    enabled: household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN',
  })

  const isAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'

  const { data: householdAccounts = [] } = useQuery<HouseholdAccount[]>({
    queryKey: ['accounts', 'household', id],
    queryFn: async () => (await api.get<HouseholdAccount[]>(`/households/${id}/accounts`)).data,
    enabled: !!id,
  })

  const createAccountMutation = useMutation({
    mutationFn: (data: AccountForm) => api.post(`/households/${id}/accounts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', 'household', id] })
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
      queryClient.invalidateQueries({ queryKey: ['accounts', 'household', id] })
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
      queryClient.invalidateQueries({ queryKey: ['accounts', 'household', id] })
    },
    onError: (err) => {
      if (axios.isAxiosError(err))
        toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to update')
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (accountId: string) => api.delete(`/households/${id}/accounts/${accountId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', 'household', id] })
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

  function openEditAccount(account: HouseholdAccount) {
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

  // Users not already in this household
  const memberUserIds = new Set(household?.members.map((m) => m.userId) ?? [])
  const availableUsers = allUsers.filter((u) => u.isActive && !memberUserIds.has(u.id))

  const addMemberMutation = useMutation({
    mutationFn: () => api.post(`/households/${id}/members`, { userId: addUserId, role: addRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      setShowAddMember(false)
      setAddUserId('')
      setAddRole('MEMBER')
      setAddError('')
      toast.success('Member added')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setAddError((err.response?.data as { error?: string })?.error ?? 'Failed to add member')
      }
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => api.delete(`/households/${id}/members/${memberId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      toast.success('Member removed')
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: 'ADMIN' | 'MEMBER' }) =>
      api.put(`/households/${id}/members/${memberId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      toast.success('Role updated')
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: () => api.put(`/households/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['households'] })
      toast.success('Household deactivated')
      navigate('/')
    },
    onError: () => toast.error('Failed to deactivate household'),
  })

  const reactivateMutation = useMutation({
    mutationFn: () => api.put(`/households/${id}/reactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      queryClient.invalidateQueries({ queryKey: ['households'] })
      toast.success('Household reactivated')
    },
    onError: () => toast.error('Failed to reactivate household'),
  })

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => api.put(`/households/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      queryClient.invalidateQueries({ queryKey: ['households'] })
      setEditingName(false)
      setNameError('')
      toast.success('Household renamed')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setNameError((err.response?.data as { error?: string })?.error ?? 'Failed to update name')
      }
    },
  })

  const updateSettingsMutation = useMutation({
    mutationFn: (settings: { autoMarkTransferPaid?: boolean; budgetModel?: BudgetModel }) =>
      api.put(`/households/${id}`, { name: household!.name, ...settings }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household', id] }),
    onError: () => toast.error('Failed to update settings'),
  })

  function handleAddMember(e: FormEvent) {
    e.preventDefault()
    setAddError('')
    addMemberMutation.mutate()
  }

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault()
    setNameError('')
    updateNameMutation.mutate(nameValue)
  }

  function startEditName() {
    setNameValue(household?.name ?? '')
    setNameError('')
    setEditingName(true)
  }

  if (isLoading) {
    return <PageLoader />
  }

  if (!household) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Household not found.</p>
          <Link to="/" className="text-amber-400 hover:text-amber-300 text-sm">← Back to households</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Household name */}
        <div className="mb-8">
          {editingName ? (
            <form onSubmit={handleNameSubmit} className="flex items-center gap-3">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                required
                autoFocus
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors"
              />
              <button type="submit" disabled={updateNameMutation.isPending} className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                {updateNameMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">
                Cancel
              </button>
              {nameError && <span className="text-red-400 text-sm">{nameError}</span>}
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{household.name}</h1>
              {isAdmin && (
                <button onClick={startEditName} className="text-gray-500 hover:text-gray-300 transition-colors text-sm">
                  Edit
                </button>
              )}
            </div>
          )}
          <p className="text-gray-400 text-sm mt-1">
            {household.members.length} {household.members.length === 1 ? 'member' : 'members'}
          </p>
        </div>

        {/* Members */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Members</h2>
          {isAdmin && (
            <button
              onClick={() => { setShowAddMember(true); setAddError('') }}
              disabled={availableUsers.length === 0}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              + Add member
            </button>
          )}
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                {isAdmin && <th className="px-4 py-3 font-medium sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {household.members.map((m) => {
                const isMe = m.userId === me?.id
                const adminCount = household.members.filter((x) => x.role === 'ADMIN').length
                const canRemove = isAdmin && !(m.role === 'ADMIN' && adminCount <= 1)
                const canToggleRole = isAdmin && !(m.role === 'ADMIN' && adminCount <= 1)

                return (
                  <tr key={m.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-white">
                      <div className="flex items-center gap-2 flex-wrap">
                        {m.user.name}
                        {isMe && <span className="text-xs text-gray-500">(you)</span>}
                        {m.user.isProxy && (
                          <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Proxy</span>
                        )}
                        {m.user.isProxy && (me?.role === 'SYSTEM_ADMIN' || me?.role === 'BOOKKEEPER') && (
                          <Link
                            to={`/income?proxyUserId=${m.userId}`}
                            className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            Manage income →
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{m.user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        m.role === 'ADMIN' ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-800 text-gray-400'
                      }`}>
                        {m.role === 'ADMIN' ? 'Admin' : 'Member'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canToggleRole && (
                            <button
                              onClick={() => setConfirmRoleChange({ member: m, newRole: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN' })}
                              disabled={updateRoleMutation.isPending}
                              className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            >
                              Make {m.role === 'ADMIN' ? 'member' : 'admin'}
                            </button>
                          )}
                          {canRemove && (
                            <button
                              onClick={() => setConfirmRemove(m)}
                              disabled={removeMemberMutation.isPending}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        {/* Household accounts */}
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
                              <Trash2 size={14} />
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
        </div>

        {/* Budget transfer settings */}
        {isAdmin && (
          <div className="mt-8 border border-gray-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Transfer settings</h2>

            {/* Budget model selector */}
            <div className="mb-6">
              <p className="text-sm font-medium text-white mb-3">Budget model</p>
              <div className="space-y-2">
                {(
                  [
                    { value: 'AVERAGE', label: 'Average', description: '1/12 of annual expenses each month. Simple and predictable.' },
                    { value: 'FORWARD_LOOKING', label: 'Forward-looking', description: 'Recalculates each month based on what\'s left to cover for the rest of the year.' },
                    { value: 'PAY_NO_PAY', label: 'Pay / No pay', description: 'Track each expense individually. Unpaid amounts roll over to the next month.' },
                  ] as { value: BudgetModel; label: string; description: string }[]
                ).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateSettingsMutation.mutate({ budgetModel: option.value })}
                    disabled={updateSettingsMutation.isPending || household.budgetModel === option.value}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors disabled:cursor-default ${
                      household.budgetModel === option.value
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-gray-700 hover:border-gray-600 bg-gray-800/50 disabled:opacity-50'
                    }`}
                  >
                    <p className={`text-sm font-medium ${household.budgetModel === option.value ? 'text-amber-400' : 'text-white'}`}>
                      {option.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-mark toggle */}
            <div className="flex items-start justify-between gap-4 pt-4 border-t border-gray-800">
              <div>
                <p className="text-sm font-medium text-white">Auto-mark transfer as paid</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  On the 1st of each month the previous month's transfer is automatically marked as paid at the planned amount.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={household.autoMarkTransferPaid}
                onClick={() => updateSettingsMutation.mutate({ autoMarkTransferPaid: !household.autoMarkTransferPaid })}
                disabled={updateSettingsMutation.isPending}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                  household.autoMarkTransferPaid ? 'bg-amber-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                    household.autoMarkTransferPaid ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Danger zone */}
        {isAdmin && (
          <div className="mt-12 border border-red-900/50 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-1">Danger zone</h2>
            {household.isActive ? (
              <>
                <p className="text-gray-400 text-sm mb-4">
                  Deactivating this household hides it from the dashboard. All data is preserved and it can be reactivated at any time.
                </p>
                <button
                  onClick={() => setConfirmDeactivate(true)}
                  className="bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Deactivate household
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-400 text-sm mb-4">This household is deactivated and hidden from the dashboard.</p>
                <button
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                  className="bg-green-950 hover:bg-green-900 border border-green-800 text-green-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {reactivateMutation.isPending ? 'Reactivating…' : 'Reactivate household'}
                </button>
              </>
            )}
          </div>
        )}
      </main>

      {/* Add member modal */}
      {showAddMember && (
        <Modal title="Add member" onClose={() => setShowAddMember(false)}>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">User</label>
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">Select a user…</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email}{u.isProxy ? ' (proxy)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as 'ADMIN' | 'MEMBER')}
                className={inputClass}
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            {addError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{addError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={addMemberMutation.isPending || !addUserId}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {addMemberMutation.isPending ? 'Adding…' : 'Add member'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddMember(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm remove member */}
      {confirmRemove && (
        <Modal title="Remove member" onClose={() => setConfirmRemove(null)} size="sm">
          <p className="text-gray-300 text-sm mb-6">
            Remove <span className="font-semibold text-white">{confirmRemove.user.name}</span> from this household? They will lose access immediately.
          </p>
          <div className="flex gap-3">
            <button onClick={() => { removeMemberMutation.mutate(confirmRemove.userId); setConfirmRemove(null) }}
              className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
              Remove
            </button>
            <button onClick={() => setConfirmRemove(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm deactivate */}
      {confirmDeactivate && (
        <Modal title="Deactivate household" onClose={() => setConfirmDeactivate(false)} size="sm">
          <p className="text-gray-300 text-sm mb-6">
            This will hide <span className="font-semibold text-white">{household.name}</span> from the dashboard. All data is preserved and the household can be reactivated from the settings page.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { deactivateMutation.mutate(); setConfirmDeactivate(false) }}
              disabled={deactivateMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Deactivate
            </button>
            <button onClick={() => setConfirmDeactivate(false)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm role change */}
      {confirmRoleChange && (
        <Modal title="Change role" onClose={() => setConfirmRoleChange(null)} size="sm">
          <p className="text-gray-300 text-sm mb-6">
            Make <span className="font-semibold text-white">{confirmRoleChange.member.user.name}</span> a{' '}
            <span className="font-semibold text-white">{confirmRoleChange.newRole === 'ADMIN' ? 'household admin' : 'regular member'}</span>?
            {confirmRoleChange.newRole === 'ADMIN' && ' They will be able to manage members and settings.'}
            {confirmRoleChange.newRole === 'MEMBER' && ' They will no longer be able to manage members and settings.'}
          </p>
          <div className="flex gap-3">
            <button onClick={() => { updateRoleMutation.mutate({ memberId: confirmRoleChange.member.userId, role: confirmRoleChange.newRole }); setConfirmRoleChange(null) }}
              className="flex-1 bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
              Confirm
            </button>
            <button onClick={() => setConfirmRoleChange(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Add/Edit account modal */}
      {(showAddAccount || editingAccount) && (
        <Modal
          title={editingAccount ? 'Edit account' : 'Add account'}
          onClose={closeAccountModal}
          size="sm"
        >
          <form onSubmit={handleAccountSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={accountForm.name}
                onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                placeholder="e.g. Shared current account"
                className={inputClass}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
              <select
                value={accountForm.type}
                onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value as AccountType })}
                className={inputClass}
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            {accountFormError && (
              <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">
                {accountFormError}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createAccountMutation.isPending || updateAccountMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {createAccountMutation.isPending || updateAccountMutation.isPending ? 'Saving…' : editingAccount ? 'Save changes' : 'Add account'}
              </button>
              <button type="button" onClick={closeAccountModal}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete account confirmation */}
      {deleteAccountTarget && (
        <Modal title="Delete account" onClose={() => { setDeleteAccountTarget(null); setAccountDeleteError('') }} size="sm">
          <p className="text-gray-300 text-sm mb-2">
            Delete <span className="font-semibold text-white">"{deleteAccountTarget.name}"</span>?
          </p>
          {deleteAccountTarget._count.expenses > 0 || deleteAccountTarget._count.savingsEntries > 0 ? (
            <p className="text-amber-400 text-xs mb-4">
              This account has {deleteAccountTarget._count.expenses + deleteAccountTarget._count.savingsEntries} associated entries.
              Remove them before deleting, or deactivate the account instead.
            </p>
          ) : (
            <p className="text-gray-500 text-xs mb-4">This action cannot be undone.</p>
          )}
          {accountDeleteError && (
            <div className="bg-red-950 border border-red-800 text-red-300 px-3 py-2 rounded-lg text-xs mb-4">
              {accountDeleteError}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => deleteAccountMutation.mutate(deleteAccountTarget.id)}
              disabled={deleteAccountMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {deleteAccountMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button onClick={() => { setDeleteAccountTarget(null); setAccountDeleteError('') }}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
