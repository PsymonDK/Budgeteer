import { useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

interface Member {
  id: string
  userId: string
  role: 'ADMIN' | 'MEMBER'
  joinedAt: string
  user: { id: string; name: string; email: string; isActive: boolean; isProxy?: boolean }
}

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
  members: Member[]
}

interface UserOption {
  id: string
  name: string
  email: string
  isActive: boolean
}

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors'

export function HouseholdPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const queryClient = useQueryClient()

  const [showAddMember, setShowAddMember] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [addError, setAddError] = useState('')

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [nameError, setNameError] = useState('')

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
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setAddError((err.response?.data as { error?: string })?.error ?? 'Failed to add member')
      }
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => api.delete(`/households/${id}/members/${memberId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household', id] }),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: 'ADMIN' | 'MEMBER' }) =>
      api.put(`/households/${id}/members/${memberId}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household', id] }),
  })

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => api.put(`/households/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', id] })
      queryClient.invalidateQueries({ queryKey: ['households'] })
      setEditingName(false)
      setNameError('')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setNameError((err.response?.data as { error?: string })?.error ?? 'Failed to update name')
      }
    },
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
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-gray-500 text-sm">Loading…</span>
      </div>
    )
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
          <table className="w-full text-sm">
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
                      {m.user.name}
                      {isMe && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                      {m.user.isProxy && (me?.role === 'SYSTEM_ADMIN' || me?.role === 'BOOKKEEPER') && (
                        <Link
                          to={`/income?proxyUserId=${m.userId}`}
                          className="text-xs text-amber-400 hover:text-amber-300 transition-colors ml-2"
                        >
                          Manage income →
                        </Link>
                      )}
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
                              onClick={() => updateRoleMutation.mutate({
                                memberId: m.userId,
                                role: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                              })}
                              disabled={updateRoleMutation.isPending}
                              className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            >
                              Make {m.role === 'ADMIN' ? 'member' : 'admin'}
                            </button>
                          )}
                          {canRemove && (
                            <button
                              onClick={() => removeMemberMutation.mutate(m.userId)}
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
      </main>

      {/* Add member modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">Add member</h2>
              <button onClick={() => setShowAddMember(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>
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
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
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
          </div>
        </div>
      )}
    </>
  )
}
