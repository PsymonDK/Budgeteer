import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
  _count: { members: number }
}

export function HouseholdsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  const createMutation = useMutation({
    mutationFn: (householdName: string) => api.post<Household>('/households', { name: householdName }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['households'] })
      setShowCreate(false)
      setName('')
      navigate(`/households/${res.data.id}`)
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string })?.error ?? 'Failed to create household')
      }
    },
  })

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    createMutation.mutate(name)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-amber-400 font-bold text-lg">☠️ Budgeteer</span>
        <div className="flex items-center gap-4">
          {user?.role === 'SYSTEM_ADMIN' && (
            <>
              <Link to="/admin/users" className="text-sm text-gray-400 hover:text-white transition-colors">Users</Link>
              <Link to="/admin/households" className="text-sm text-gray-400 hover:text-white transition-colors">All households</Link>
            </>
          )}
          <Link to="/change-password" className="text-sm text-gray-400 hover:text-white transition-colors">Change password</Link>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Your households</h1>
          <button
            onClick={() => { setShowCreate(true); setError('') }}
            className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            + New household
          </button>
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : households.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-2">No households yet</p>
            <p className="text-sm">Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {households.map((h) => (
              <button
                key={h.id}
                onClick={() => navigate(`/households/${h.id}`)}
                className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 text-left transition-colors w-full"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{h.name}</h2>
                    <p className="text-sm text-gray-400 mt-0.5">
                      {h._count.members} {h._count.members === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    h.myRole === 'ADMIN'
                      ? 'bg-amber-900/50 text-amber-300'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {h.myRole === 'ADMIN' ? 'Admin' : 'Member'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">New household</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors"
                  placeholder="e.g. Family Budget"
                />
              </div>
              {error && (
                <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
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
          </div>
        </div>
      )}
    </div>
  )
}
