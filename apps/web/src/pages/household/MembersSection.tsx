import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { Household, HouseholdMember } from '../../api/types'
import type { AuthUser } from '../../contexts/AuthContext'
import { Modal } from '../../components/Modal'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { getApiError } from '../../lib/apiError'

// GET /users returns full records to admins/bookkeepers and only { id, name } to others
interface UserOption {
  id: string
  name: string
  email?: string
  isActive?: boolean
  isProxy?: boolean
}

interface MembersSectionProps {
  householdId: string
  household: Household
  isAdmin: boolean
  me: AuthUser | null
}

/** Member list with add / remove / role change for household admins. */
export function MembersSection({ householdId: id, household, isAdmin, me }: MembersSectionProps) {
  const queryClient = useQueryClient()

  const [showAddMember, setShowAddMember] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [addError, setAddError] = useState('')

  // Confirmation dialogs
  const [confirmRemove, setConfirmRemove] = useState<HouseholdMember | null>(null)
  const [confirmRoleChange, setConfirmRoleChange] = useState<{ member: HouseholdMember; newRole: 'ADMIN' | 'MEMBER' } | null>(null)

  // All system users — for the "add member" dropdown
  const { data: allUsers = [] } = useQuery<UserOption[]>({
    queryKey: qk.users(),
    queryFn: async () => (await api.get<UserOption[]>('/users')).data,
    enabled: household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN',
  })

  // Users not already in this household
  const memberUserIds = new Set(household?.members.map((m) => m.userId) ?? [])
  // Non-admin callers get a minimal { id, name } list of active users (no email/isActive),
  // so only an explicit isActive: false excludes a user
  const availableUsers = allUsers.filter((u) => u.isActive !== false && !memberUserIds.has(u.id))

  const addMemberMutation = useMutation({
    mutationFn: () => api.post(`/households/${id}/members`, { userId: addUserId, role: addRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
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
    onError: (err) => toast.error(getApiError(err, 'Failed to remove member')),
    mutationFn: (memberId: string) => api.delete(`/households/${id}/members/${memberId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
      toast.success('Member removed')
    },
  })

  const updateRoleMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to change role')),
    mutationFn: ({ memberId, role }: { memberId: string; role: 'ADMIN' | 'MEMBER' }) =>
      api.put(`/households/${id}/members/${memberId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
      toast.success('Role updated')
    },
  })

  function handleAddMember(e: FormEvent) {
    e.preventDefault()
    setAddError('')
    addMemberMutation.mutate()
  }

  return (
    <>
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
              {isAdmin && <th className="relative px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>}
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
                      m.role === 'ADMIN' ? 'bg-gray-800 text-gray-100 ring-1 ring-inset ring-gray-600' : 'bg-gray-800 text-gray-400'
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
                    {u.name}{u.email ? ` — ${u.email}` : ''}{u.isProxy ? ' (proxy)' : ''}
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
            <FormError message={addError} />
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={addMemberMutation.isPending || !addUserId}
                className={`flex-1 ${primaryBtn}`}
              >
                {addMemberMutation.isPending ? 'Adding…' : 'Add member'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddMember(false)}
                className={`flex-1 ${secondaryBtn}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm remove member */}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove member"
          onClose={() => setConfirmRemove(null)}
          onConfirm={() => { removeMemberMutation.mutate(confirmRemove.userId); setConfirmRemove(null) }}
          confirmLabel="Remove"
        >
          <p className="text-gray-300 text-sm mb-6">
            Remove <span className="font-semibold text-white">{confirmRemove.user.name}</span> from this household? They will lose access immediately.
          </p>
        </ConfirmDialog>
      )}

      {/* Confirm role change */}
      {confirmRoleChange && (
        <ConfirmDialog
          title="Change role"
          onClose={() => setConfirmRoleChange(null)}
          onConfirm={() => { updateRoleMutation.mutate({ memberId: confirmRoleChange.member.userId, role: confirmRoleChange.newRole }); setConfirmRoleChange(null) }}
          confirmClassName={primaryBtn}
          confirmLabel="Confirm"
        >
          <p className="text-gray-300 text-sm mb-6">
            Make <span className="font-semibold text-white">{confirmRoleChange.member.user.name}</span> a{' '}
            <span className="font-semibold text-white">{confirmRoleChange.newRole === 'ADMIN' ? 'household admin' : 'regular member'}</span>?
            {confirmRoleChange.newRole === 'ADMIN' && ' They will be able to manage members and settings.'}
            {confirmRoleChange.newRole === 'MEMBER' && ' They will no longer be able to manage members and settings.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
