import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, RefreshCw, Pencil } from 'lucide-react'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'

interface AdminCurrency {
  code: string
  name: string
  isEnabled: boolean
  isBase: boolean
  rate: number | null
  lastUpdated: string | null
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function CurrenciesAdminPage() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminCurrency | null>(null)

  // Add form
  const [addCode, setAddCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addRate, setAddRate] = useState('')

  // Edit form
  const [editName, setEditName] = useState('')
  const [editRate, setEditRate] = useState('')

  const { data: currencies = [], isLoading } = useQuery<AdminCurrency[]>({
    queryKey: ['admin', 'currencies'],
    queryFn: async () => (await api.get<AdminCurrency[]>('/admin/currencies')).data,
  })

  const addMutation = useMutation({
    mutationFn: (body: { code: string; name: string; rate: number }) =>
      api.post('/admin/currencies', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'currencies'] })
      toast.success('Currency added')
      setAddOpen(false)
      setAddCode('')
      setAddName('')
      setAddRate('')
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? 'Failed to add currency')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ code, body }: { code: string; body: { name?: string; rate?: number; isEnabled?: boolean } }) =>
      api.patch(`/admin/currencies/${code}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'currencies'] })
      toast.success('Currency updated')
      setEditTarget(null)
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? 'Failed to update currency')
    },
  })

  const refreshMutation = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/admin/currencies/refresh'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'currencies'] })
      queryClient.invalidateQueries({ queryKey: ['currencies'] })
      toast.success(`Rates synced — ${res.data.updated} currencies updated`)
    },
    onError: () => toast.error('Rate sync failed'),
  })

  function openEdit(c: AdminCurrency) {
    setEditTarget(c)
    setEditName(c.name)
    setEditRate(c.rate != null ? String(c.rate) : '')
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const rate = parseFloat(addRate)
    if (isNaN(rate) || rate <= 0) { toast.error('Rate must be a positive number'); return }
    addMutation.mutate({ code: addCode.toUpperCase().trim(), name: addName.trim(), rate })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const body: { name?: string; rate?: number } = {}
    if (editName.trim() && editName.trim() !== editTarget.name) body.name = editName.trim()
    if (editRate && parseFloat(editRate) !== editTarget.rate) {
      const r = parseFloat(editRate)
      if (isNaN(r) || r <= 0) { toast.error('Rate must be a positive number'); return }
      body.rate = r
    }
    if (Object.keys(body).length === 0) { setEditTarget(null); return }
    updateMutation.mutate({ code: editTarget.code, body })
  }

  function toggleEnabled(c: AdminCurrency) {
    updateMutation.mutate({ code: c.code, body: { isEnabled: !c.isEnabled } })
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Currencies</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage available currencies and their conversion rates relative to the base currency.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className={`${secondaryBtn} flex items-center gap-2`}
          >
            <RefreshCw size={14} className={refreshMutation.isPending ? 'animate-spin' : ''} />
            Sync rates
          </button>
          <button onClick={() => setAddOpen(true)} className={`${primaryBtn} flex items-center gap-2`}>
            <Plus size={14} />
            Add currency
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : currencies.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No currencies yet — add one to get started.</div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Last updated</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => (
                <tr key={c.code} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-mono font-semibold text-white">
                    {c.code}
                    {c.isBase && (
                      <span className="ml-2 text-xs bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded-full font-sans">
                        base
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-200">{c.name}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">
                    {c.isBase ? '1.000000' : c.rate != null ? c.rate.toFixed(6) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{formatDate(c.lastUpdated)}</td>
                  <td className="px-4 py-3">
                    {c.isEnabled ? (
                      <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full">
                        Enabled
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-gray-400 hover:text-white transition-colors"
                        aria-label={`Edit ${c.code}`}
                      >
                        <Pencil size={14} />
                      </button>
                      {!c.isBase && (
                        <button
                          onClick={() => toggleEnabled(c)}
                          disabled={updateMutation.isPending}
                          className="text-xs text-gray-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                        >
                          {c.isEnabled ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      {addOpen && (
        <Modal title="Add currency" onClose={() => setAddOpen(false)} size="sm">
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Currency code</label>
              <input
                className={inputClass}
                placeholder="e.g. EUR"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                maxLength={4}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                className={inputClass}
                placeholder="e.g. Euro"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Initial conversion rate</label>
              <input
                className={inputClass}
                type="number"
                step="any"
                min="0.000001"
                placeholder="e.g. 0.134"
                value={addRate}
                onChange={(e) => setAddRate(e.target.value)}
                required
              />
              <p className="text-xs text-gray-500 mt-1">Units of this currency per 1 unit of the base currency.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setAddOpen(false)} className={secondaryBtn}>
                Cancel
              </button>
              <button type="submit" disabled={addMutation.isPending} className={primaryBtn}>
                {addMutation.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal title={`Edit ${editTarget.code}`} onClose={() => setEditTarget(null)} size="sm">
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                className={inputClass}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                autoFocus
              />
            </div>
            {!editTarget.isBase && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Conversion rate</label>
                <input
                  className={inputClass}
                  type="number"
                  step="any"
                  min="0.000001"
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Leave unchanged to keep the current rate.</p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditTarget(null)} className={secondaryBtn}>
                Cancel
              </button>
              <button type="submit" disabled={updateMutation.isPending} className={primaryBtn}>
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
