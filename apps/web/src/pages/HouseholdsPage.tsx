import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { api } from '../api/client'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'
import { AppFooter } from '../components/AppFooter'

interface Household {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER' | null
  _count: { members: number }
}

export function HouseholdsPage() {
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    createMutation.mutate(name)
  }

  return (
    <div className="flex-1 flex flex-col">
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
        <PageHeader
          title="Your households"
          action={
            <button
              onClick={() => { setShowCreate(true); setError('') }}
              className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              + New household
            </button>
          }
        />

        {isLoading ? (
          <PageLoader />
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
      <AppFooter />
      {showCreate && (
        <Modal title="New household" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className={inputClass}
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
        </Modal>
      )}
    </div>
  )
}
