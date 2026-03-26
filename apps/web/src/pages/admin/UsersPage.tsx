import { useState, type ReactNode, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { PageLoader } from '../../components/LoadingSpinner'
import { inputClass } from '../../lib/styles'

interface User {
  id: string
  email: string
  name: string
  role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER'
  isActive: boolean
  isProxy: boolean
  mustChangePassword: boolean
  createdAt: string
}

interface UserFormData {
  email: string
  name: string
  password: string
  isProxy: boolean
}

interface EditFormData {
  name: string
  email: string
  isActive: boolean
  isProxy: boolean
  role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER'
}

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        active ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function ProxyBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-900/50 text-purple-300 ml-1">
      Proxy
    </span>
  )
}

function roleLabel(role: string) {
  if (role === 'SYSTEM_ADMIN') return 'Sys Admin'
  if (role === 'BOOKKEEPER') return 'Bookkeeper'
  return 'User'
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [resetUser, setResetUser] = useState<User | null>(null)
  const [formError, setFormError] = useState('')

  const [createForm, setCreateForm] = useState<UserFormData>({ email: '', name: '', password: '', isProxy: false })
  const [editForm, setEditForm] = useState<EditFormData>({ name: '', email: '', isActive: true, isProxy: false, role: 'USER' })
  const [resetPassword, setResetPassword] = useState('')

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get<User[]>('/users')
      return res.data
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: UserFormData) => api.post<User>('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreate(false)
      setCreateForm({ email: '', name: '', password: '', isProxy: false })
      setFormError('')
      toast.success('User created')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to create user')
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EditFormData> }) =>
      api.put<User>(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
      setFormError('')
      toast.success('User updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to update user')
      }
    },
  })

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post<User>(`/users/${id}/reset-password`, { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setResetUser(null)
      setResetPassword('')
      setFormError('')
      toast.success('Password reset')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setFormError((err.response?.data as { error?: string })?.error ?? 'Failed to reset password')
      }
    },
  })

  function openEdit(user: User) {
    setEditingUser(user)
    setEditForm({ name: user.name, email: user.email, isActive: user.isActive, isProxy: user.isProxy, role: user.role })
    setFormError('')
  }

  function openReset(user: User) {
    setResetUser(user)
    setResetPassword('')
    setFormError('')
  }

  function handleReset(e: FormEvent) {
    e.preventDefault()
    if (!resetUser) return
    setFormError('')
    resetMutation.mutate({ id: resetUser.id, password: resetPassword })
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const payload = createForm.isProxy
      ? { name: createForm.name, email: createForm.email, isProxy: true }
      : createForm
    createMutation.mutate(payload as UserFormData)
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    setFormError('')
    updateMutation.mutate({ id: editingUser.id, data: editForm })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Users</h1>
          <button
            onClick={() => { setShowCreate(true); setFormError('') }}
            className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + New user
          </button>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-white">
                      {u.name}
                      {u.isProxy && <ProxyBadge />}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${u.role === 'SYSTEM_ADMIN' ? 'text-amber-400' : u.role === 'BOOKKEEPER' ? 'text-blue-400' : 'text-gray-400'}`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge active={u.isActive} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-4">
                        {!u.isProxy && (
                          <button
                            onClick={() => openReset(u)}
                            className="text-xs text-gray-400 hover:text-amber-400 transition-colors"
                          >
                            Reset password
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(u)}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create user modal */}
      {showCreate && (
        <Modal title="New user" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Name">
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
                className={inputClass}
                placeholder="Jane Smith"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                required
                className={inputClass}
                placeholder="jane@example.com"
              />
            </Field>
            <Field label="Account type">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.isProxy}
                  onChange={(e) => setCreateForm({ ...createForm, isProxy: e.target.checked })}
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span className="text-gray-300 text-sm">Proxy user (cannot log in directly)</span>
              </label>
            </Field>
            {!createForm.isProxy && (
              <Field label="Temporary password">
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required={!createForm.isProxy}
                  minLength={8}
                  className={inputClass}
                  placeholder="Min. 8 characters"
                />
              </Field>
            )}
            {createForm.isProxy && (
              <p className="text-xs text-amber-400/80 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2">
                Proxy users cannot log in directly. A bookkeeper or admin can enter income on their behalf.
              </p>
            )}
            {formError && <ErrorMsg>{formError}</ErrorMsg>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={createMutation.isPending} className={submitClass}>
                {createMutation.isPending ? 'Creating…' : 'Create user'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className={cancelClass}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <Modal title={`Reset password — ${resetUser.name}`} onClose={() => setResetUser(null)}>
          <p className="text-sm text-gray-400 mb-4">
            The user will be required to change their password on next login.
          </p>
          <form onSubmit={handleReset} className="space-y-4">
            <Field label="New temporary password">
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
                className={inputClass}
                placeholder="Min. 8 characters"
              />
            </Field>
            {formError && <ErrorMsg>{formError}</ErrorMsg>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={resetMutation.isPending} className={submitClass}>
                {resetMutation.isPending ? 'Saving…' : 'Reset password'}
              </button>
              <button type="button" onClick={() => setResetUser(null)} className={cancelClass}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit user modal */}
      {editingUser && (
        <Modal title="Edit user" onClose={() => setEditingUser(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <Field label="Name">
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Role">
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as EditFormData['role'] })}
                disabled={editForm.isProxy}
                className={inputClass}
              >
                <option value="USER">User</option>
                <option value="BOOKKEEPER">Bookkeeper</option>
                <option value="SYSTEM_ADMIN">System Admin</option>
              </select>
              {editForm.isProxy && (
                <p className="text-xs text-gray-500 mt-1">Proxy users can only have the User role.</p>
              )}
            </Field>
            <Field label="Account status">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span className="text-gray-300 text-sm">Active</span>
              </label>
            </Field>
            <Field label="Proxy user">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isProxy}
                  onChange={(e) => {
                    const isProxy = e.target.checked
                    setEditForm({ ...editForm, isProxy, role: isProxy ? 'USER' : editForm.role })
                  }}
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span className="text-gray-300 text-sm">Cannot log in directly</span>
              </label>
            </Field>
            {formError && <ErrorMsg>{formError}</ErrorMsg>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={updateMutation.isPending} className={submitClass}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" onClick={() => setEditingUser(null)} className={cancelClass}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Small shared sub-components ──────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  )
}

function ErrorMsg({ children }: { children: ReactNode }) {
  return (
    <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">
      {children}
    </div>
  )
}

const submitClass =
  'flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors'

const cancelClass =
  'flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg px-4 py-2.5 text-sm transition-colors'
