import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'

interface AutomationRun {
  id: string
  triggeredBy: 'SCHEDULE' | 'MANUAL'
  triggeredByUserId: string | null
  startedAt: string
  finishedAt: string
  status: 'SUCCESS' | 'ERROR' | 'SKIPPED'
  message: string | null
}

interface Automation {
  id: string
  key: string
  label: string
  description: string
  schedule: string
  isEnabled: boolean
  lastRunAt: string | null
  lastRunStatus: 'SUCCESS' | 'ERROR' | 'SKIPPED' | null
  household: { id: string; name: string }
  _count: { runs: number }
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function humanSchedule(cron: string): string {
  if (cron === '0 0 1 * *') return '1st of every month'
  if (cron === '0 6 * * *') return 'Daily at 06:00'
  return cron
}

function StatusBadge({ status }: { status: 'SUCCESS' | 'ERROR' | 'SKIPPED' | null }) {
  if (!status) return <span className="text-gray-600 text-xs">Never run</span>
  const styles = {
    SUCCESS: 'bg-green-900/50 text-green-300',
    ERROR: 'bg-red-900/50 text-red-300',
    SKIPPED: 'bg-gray-800 text-gray-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {status}
    </span>
  )
}

export function AutomationsAdminPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [runAllLoading, setRunAllLoading] = useState(false)
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null)
  const [runsModal, setRunsModal] = useState<{ automation: Automation; runs: AutomationRun[] } | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)

  const { data: automations = [], isLoading } = useQuery<Automation[]>({
    queryKey: ['admin', 'automations'],
    queryFn: async () => (await api.get<Automation[]>('/admin/automations')).data,
  })

  async function handleRunAll() {
    setRunAllLoading(true)
    try {
      await api.post('/admin/automations/trigger-all')
      queryClient.invalidateQueries({ queryKey: ['admin', 'automations'] })
    } finally {
      setRunAllLoading(false)
    }
  }

  async function handleToggle(automation: Automation) {
    await api.patch(`/admin/automations/${automation.id}/toggle`)
    queryClient.invalidateQueries({ queryKey: ['admin', 'automations'] })
  }

  async function handleTrigger(automation: Automation) {
    setTriggerLoading(automation.id)
    try {
      await api.post(`/admin/automations/${automation.id}/trigger`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'automations'] })
    } finally {
      setTriggerLoading(null)
    }
  }

  async function handleViewRuns(automation: Automation) {
    setRunsLoading(true)
    try {
      const res = await api.get<AutomationRun[]>(`/admin/automations/${automation.id}/runs`)
      setRunsModal({ automation, runs: res.data })
    } finally {
      setRunsLoading(false)
    }
  }

  if (!user || user.role !== 'SYSTEM_ADMIN') {
    return <div className="p-8 text-red-400">Access denied.</div>
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <Zap size={20} className="text-amber-400" />
            Automations
          </h1>
          <p className="text-gray-400 text-sm">Manage scheduled background automations across all households.</p>
        </div>
        <button
          onClick={handleRunAll}
          disabled={runAllLoading}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-medium text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {runAllLoading ? 'Running…' : 'Run All'}
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : automations.length === 0 ? (
        <p className="text-gray-600 text-sm">No automations registered.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Household</th>
                <th className="px-4 py-3 font-medium">Automation</th>
                <th className="px-4 py-3 font-medium">Schedule</th>
                <th className="px-4 py-3 font-medium">Last Run</th>
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                  <td className="px-4 py-3 text-white">{a.household.name}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{a.label}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{a.description}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{humanSchedule(a.schedule)}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-400 text-xs mb-1">{relativeTime(a.lastRunAt)}</div>
                    <StatusBadge status={a.lastRunStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(a)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        a.isEnabled ? 'bg-amber-500' : 'bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          a.isEnabled ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleTrigger(a)}
                        disabled={triggerLoading === a.id}
                        className="text-amber-400 hover:text-amber-300 disabled:opacity-50 text-xs font-medium transition-colors"
                      >
                        {triggerLoading === a.id ? 'Running…' : 'Trigger Now'}
                      </button>
                      <button
                        onClick={() => handleViewRuns(a)}
                        disabled={runsLoading}
                        className="text-gray-400 hover:text-white text-xs transition-colors"
                      >
                        View runs ({a._count.runs})
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Run history modal */}
      {runsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Run History — {runsModal.automation.label}
              </h3>
              <button
                onClick={() => setRunsModal(null)}
                className="text-gray-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {runsModal.runs.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No runs recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-left border-b border-gray-800">
                      <th className="pb-2 font-medium">Started</th>
                      <th className="pb-2 font-medium">Triggered by</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsModal.runs.map((r) => (
                      <tr key={r.id} className="border-b border-gray-800 last:border-0">
                        <td className="py-2 text-gray-400 text-xs tabular-nums">
                          {new Date(r.startedAt).toLocaleString()}
                        </td>
                        <td className="py-2 text-gray-400 text-xs">{r.triggeredBy}</td>
                        <td className="py-2"><StatusBadge status={r.status} /></td>
                        <td className="py-2 text-gray-500 text-xs truncate max-w-xs" title={r.message ?? ''}>
                          {r.message ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
