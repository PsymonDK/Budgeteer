import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'

// ── Types ─────────────────────────────────────────────────────────────────────

type BudgetMode = 'ONE_OFF' | 'SPREAD_ANNUALLY'

interface SalaryRecord {
  id: string
  jobId: string
  grossAmount: string
  netAmount: string
  effectiveFrom: string
  createdAt: string
}

interface MonthlyOverride {
  id: string
  jobId: string
  year: number
  month: number
  grossAmount: string
  netAmount: string
  note: string | null
  createdAt: string
}

interface Bonus {
  id: string
  jobId: string
  label: string
  grossAmount: string
  netAmount: string
  paymentDate: string
  includeInBudget: boolean
  budgetMode: BudgetMode | null
  createdAt: string
}

interface JobAllocation {
  budgetYearId: string
  allocationPct: string
  budgetYear: {
    id: string
    year: number
    status: string
    household: { id: string; name: string }
  }
}

interface Job {
  id: string
  name: string
  employer: string | null
  startDate: string
  endDate: string | null
  isActive: boolean
  latestSalary: SalaryRecord | null
  upcomingBonusCount: number
  allocations: JobAllocation[]
}

interface Household {
  id: string
  name: string
}

interface HistoryBucket {
  period: string
  gross: number
  net: number
  total: number
  perJob: { jobId: string; jobName: string; gross: number; net: number }[]
  bonuses: { jobId: string; label: string; gross: number; net: number }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors text-sm'

// (kept local to avoid breaking existing usage)

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(v: number | string) {
  return Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

function toDateInput(iso: string) {
  return iso.slice(0, 10)
}

type Tab = 'jobs' | 'overrides' | 'bonuses'
type Granularity = 'monthly' | 'quarterly' | 'yearly'

// ── Sub-forms ─────────────────────────────────────────────────────────────────

interface JobForm { name: string; employer: string; startDate: string; endDate: string }
interface SalaryForm { grossAmount: string; netAmount: string; effectiveFrom: string }
interface OverrideForm { year: string; month: string; grossAmount: string; netAmount: string; note: string }
interface BonusForm { label: string; grossAmount: string; netAmount: string; paymentDate: string; includeInBudget: boolean; budgetMode: BudgetMode | '' }

const emptyJob: JobForm = { name: '', employer: '', startDate: new Date().toISOString().slice(0, 10), endDate: '' }
const emptySalary: SalaryForm = { grossAmount: '', netAmount: '', effectiveFrom: new Date().toISOString().slice(0, 10) }
const emptyOverride: OverrideForm = { year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1), grossAmount: '', netAmount: '', note: '' }
const emptyBonus: BonusForm = { label: '', grossAmount: '', netAmount: '', paymentDate: new Date().toISOString().slice(0, 10), includeInBudget: true, budgetMode: 'ONE_OFF' }

// ── Component ─────────────────────────────────────────────────────────────────

export function IncomePage() {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const proxyUserId = params.get('proxyUserId')
  const isProxy = !!proxyUserId && (me?.role === 'SYSTEM_ADMIN' || me?.role === 'BOOKKEEPER')
  const targetUserId = isProxy ? proxyUserId : me?.id

  const [activeTab, setActiveTab] = useState<Tab>('jobs')

  // Job modal
  const [showAddJob, setShowAddJob] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [jobForm, setJobForm] = useState<JobForm>(emptyJob)
  const [jobFormError, setJobFormError] = useState('')

  // Salary modal
  const [salaryJobId, setSalaryJobId] = useState<string | null>(null)
  const [salaryForm, setSalaryForm] = useState<SalaryForm>(emptySalary)
  const [salaryError, setSalaryError] = useState('')

  // Override modal
  const [overrideJobId, setOverrideJobId] = useState<string | null>(null)
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(emptyOverride)
  const [overrideError, setOverrideError] = useState('')

  // Bonus modal
  const [bonusJobId, setBonusJobId] = useState<string | null>(null)
  const [editingBonus, setEditingBonus] = useState<Bonus | null>(null)
  const [bonusForm, setBonusForm] = useState<BonusForm>(emptyBonus)
  const [bonusError, setBonusError] = useState('')

  // Allocations
  const [pendingAllocations, setPendingAllocations] = useState<Record<string, string>>({})
  const [allocError, setAllocError] = useState('')
  const [allocationsDirty, setAllocationsDirty] = useState(false)

  // Confirmation dialogs
  const [confirmCloseJob, setConfirmCloseJob] = useState<Job | null>(null)
  const [confirmDeleteBonus, setConfirmDeleteBonus] = useState<{ jobId: string; bonusId: string } | null>(null)
  const [confirmDeleteOverride, setConfirmDeleteOverride] = useState<{ jobId: string; overrideId: string } | null>(null)

  // History chart
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 7)
  })
  const [histTo, setHistTo] = useState(() => new Date().toISOString().slice(0, 7))
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [showGross, setShowGross] = useState(false)

  // ── Queries ───────────────────────────────────────────────────────────────

  // Fetch users list to get proxy user name (only when acting as proxy)
  const { data: allUsers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/users')).data,
    enabled: isProxy,
  })
  const proxyUserName = isProxy ? allUsers.find((u) => u.id === proxyUserId)?.name : undefined

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ['jobs', targetUserId],
    queryFn: async () => (await api.get<Job[]>(`/users/${targetUserId}/jobs`)).data,
    enabled: !!targetUserId,
  })

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  const { data: salaryRecords = [] } = useQuery<SalaryRecord[]>({
    queryKey: ['salary', salaryJobId],
    queryFn: async () => (await api.get<SalaryRecord[]>(`/jobs/${salaryJobId}/salary`)).data,
    enabled: !!salaryJobId,
  })

  // Load overrides for all jobs on the overrides tab
  const { data: allJobsOverrides = {} } = useQuery<Record<string, MonthlyOverride[]>>({
    queryKey: ['all-overrides', jobs.map((j) => j.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<MonthlyOverride[]>(`/jobs/${j.id}/overrides`)
          return [j.id, res.data] as [string, MonthlyOverride[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'overrides' && jobs.length > 0,
  })

  // Load bonuses for all jobs on the bonuses tab
  const { data: allJobsBonuses = {} } = useQuery<Record<string, Bonus[]>>({
    queryKey: ['all-bonuses', jobs.map((j) => j.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<Bonus[]>(`/jobs/${j.id}/bonuses`)
          return [j.id, res.data] as [string, Bonus[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'bonuses' && jobs.length > 0,
  })

  const { data: historyData } = useQuery<{ buckets: HistoryBucket[] }>({
    queryKey: ['income-history', targetUserId, histFrom, histTo, granularity],
    queryFn: async () =>
      (await api.get(`/users/${targetUserId}/income/history`, { params: { from: histFrom, to: histTo, granularity } })).data,
    enabled: !!targetUserId,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.post(`/users/${targetUserId}/jobs`, {
        name: data.name, employer: data.employer || undefined,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setShowAddJob(false); setJobForm(emptyJob); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.put(`/users/${targetUserId}/jobs/${editingJob!.id}`, {
        name: data.name, employer: data.employer || undefined,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setEditingJob(null); setJobForm(emptyJob); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const closeJobMutation = useMutation({
    mutationFn: (jobId: string) => api.delete(`/users/${targetUserId}/jobs/${jobId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job closed') },
  })

  const addSalaryMutation = useMutation({
    mutationFn: (data: SalaryForm) =>
      api.post(`/jobs/${salaryJobId}/salary`, {
        grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount), effectiveFrom: data.effectiveFrom,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary', salaryJobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setSalaryForm(emptySalary); setSalaryError('')
      toast.success('Salary record added')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setSalaryError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const upsertOverrideMutation = useMutation({
    mutationFn: (data: OverrideForm) =>
      api.post(`/jobs/${overrideJobId}/overrides`, {
        year: parseInt(data.year), month: parseInt(data.month),
        grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        note: data.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overrides', overrideJobId] })
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
      setOverrideForm(emptyOverride); setOverrideError('')
      toast.success('Monthly override saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setOverrideError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteOverrideMutation = useMutation({
    mutationFn: ({ jobId, overrideId }: { jobId: string; overrideId: string }) =>
      api.delete(`/jobs/${jobId}/overrides/${overrideId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
      toast.success('Override deleted')
    },
  })

  const createBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.post(`/jobs/${bonusJobId}/bonuses`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bonuses'] })
      setBonusJobId(null); setBonusForm(emptyBonus); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.put(`/jobs/${editingBonus!.jobId}/bonuses/${editingBonus!.id}`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bonuses'] })
      setEditingBonus(null); setBonusForm(emptyBonus); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteBonusMutation = useMutation({
    mutationFn: ({ jobId, bonusId }: { jobId: string; bonusId: string }) =>
      api.delete(`/jobs/${jobId}/bonuses/${bonusId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-bonuses'] }); toast.success('Bonus deleted') },
  })

  const allocMutation = useMutation({
    mutationFn: ({ jobId, householdId, pct }: { jobId: string; householdId: string; pct: number }) =>
      pct === 0
        ? api.delete(`/income/${jobId}/allocations/${householdId}`)
        : api.put(`/income/${jobId}/allocations/${householdId}`, { allocationPct: pct }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setPendingAllocations({}); setAllocationsDirty(false); setAllocError(''); toast.success('Allocations saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setAllocError((err.response?.data as { error?: string })?.error ?? 'Failed to save allocation') },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getAllocationPct(job: Job, householdId: string): string {
    const key = `${job.id}:${householdId}`
    if (key in pendingAllocations) return pendingAllocations[key]
    const alloc = job.allocations.find((a) => a.budgetYear.household.id === householdId)
    return alloc ? alloc.allocationPct : '0'
  }

  function saveAllocations(job: Job) {
    setAllocError('')
    const dirty = Object.entries(pendingAllocations).filter(([key]) => key.startsWith(`${job.id}:`))
    if (dirty.length === 0) return
    for (const [key, value] of dirty) {
      const householdId = key.split(':')[1]
      allocMutation.mutate({ jobId: job.id, householdId, pct: parseFloat(value) || 0 })
    }
  }

  function openEditJob(job: Job) {
    setJobForm({ name: job.name, employer: job.employer ?? '', startDate: toDateInput(job.startDate), endDate: job.endDate ? toDateInput(job.endDate) : '' })
    setJobFormError('')
    setEditingJob(job)
  }

  function handleJobSubmit(e: FormEvent) {
    e.preventDefault(); setJobFormError('')
    if (editingJob) updateJobMutation.mutate(jobForm)
    else createJobMutation.mutate(jobForm)
  }

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = (historyData?.buckets ?? []).map((b) => ({
    period: b.period,
    net: parseFloat(b.net.toFixed(2)),
    gross: parseFloat(b.gross.toFixed(2)),
    bonuses: parseFloat(b.bonuses.reduce((s, x) => s + (showGross ? x.gross : x.net), 0).toFixed(2)),
  }))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Proxy banner ────────────────────────────────────────────────── */}
        {isProxy && proxyUserName && (
          <div className="bg-amber-950 border border-amber-700 text-amber-300 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <span>⚠ Entering income on behalf of <strong>{proxyUserName}</strong></span>
          </div>
        )}

        {/* ── Income History Chart ─────────────────────────────────────────── */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-semibold">Income History</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">From</label>
                <input type="month" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">To</label>
                <input type="month" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                {(['monthly', 'quarterly', 'yearly'] as Granularity[]).map((g) => (
                  <button key={g} onClick={() => setGranularity(g)}
                    className={`px-3 py-1.5 transition-colors ${granularity === g ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                <button onClick={() => setShowGross(false)}
                  className={`px-3 py-1.5 transition-colors ${!showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Net</button>
                <button onClick={() => setShowGross(true)}
                  className={`px-3 py-1.5 transition-colors ${showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Gross</button>
              </div>
            </div>
          </div>

          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data for selected period</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="period" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
                  itemStyle={{ color: '#d1d5db' }}
                  formatter={(value: number) => fmt(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar dataKey="bonuses" name="Bonuses" fill="#d97706" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey={showGross ? 'gross' : 'net'} name={showGross ? 'Gross income' : 'Net income'} stroke="#fbbf24" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div>
          <div className="flex border-b border-gray-800 mb-6">
            {([['jobs', 'Jobs & Salary'], ['overrides', 'Monthly Overrides'], ['bonuses', 'Bonuses']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Jobs & Salary tab ─────────────────────────────────────────── */}
          {activeTab === 'jobs' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Jobs & Salary</h2>
                <button onClick={() => { setShowAddJob(true); setJobForm(emptyJob); setJobFormError('') }}
                  className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                  + Add job
                </button>
              </div>

              {isLoading ? (
                <PageLoader />
              ) : jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <p className="text-lg mb-2">No jobs yet</p>
                  <p className="text-sm">Add a job to start tracking your salary history.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => (
                    <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                      {/* Job header */}
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-white font-semibold text-base">{job.name}</h3>
                            {job.isActive
                              ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Active</span>
                              : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">Ended</span>
                            }
                          </div>
                          {job.employer && <p className="text-gray-400 text-sm mt-0.5">{job.employer}</p>}
                          <p className="text-gray-500 text-xs mt-1">
                            {fmtDate(job.startDate)}{job.endDate ? ` – ${fmtDate(job.endDate)}` : ' – present'}
                          </p>
                          {job.latestSalary && (
                            <p className="text-amber-400 text-sm font-medium mt-1">
                              Net {fmt(job.latestSalary.netAmount)} / month
                              <span className="text-gray-500 text-xs font-normal ml-2">(gross {fmt(job.latestSalary.grossAmount)})</span>
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => { setSalaryJobId(job.id); setSalaryForm(emptySalary); setSalaryError('') }}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Salary history</button>
                          <button onClick={() => openEditJob(job)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                          {job.isActive && (
                            <button onClick={() => setConfirmCloseJob(job)}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors">Close</button>
                          )}
                        </div>
                      </div>

                      {/* Allocations */}
                      {households.length > 0 && (
                        <div className="border-t border-gray-800 pt-4">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Household allocations</p>
                          <div className="space-y-2">
                            {households.map((h) => {
                              const pctStr = getAllocationPct(job, h.id)
                              const pct = parseFloat(pctStr) || 0
                              const net = job.latestSalary ? parseFloat(job.latestSalary.netAmount) * pct / 100 : 0
                              return (
                                <div key={h.id} className="flex items-center gap-3">
                                  <span className="text-sm text-gray-300 w-44 truncate">{h.name}</span>
                                  <div className="flex items-center gap-2 flex-1">
                                    <input type="number" value={pctStr}
                                      onChange={(e) => { setPendingAllocations((prev) => ({ ...prev, [`${job.id}:${h.id}`]: e.target.value })); setAllocationsDirty(true) }}
                                      min="0" max="999" step="1"
                                      className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums" />
                                    <span className="text-gray-500 text-sm">%</span>
                                    {pct > 0 && job.latestSalary && (
                                      <span className="text-gray-400 text-xs tabular-nums">= {fmt(net)} / mo net</span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {(() => {
                            const totalPct = Object.entries(pendingAllocations)
                              .filter(([k]) => k.startsWith(`${job.id}:`))
                              .reduce((acc, [, v]) => acc + (Number(v) || 0), 0)
                            const isOver = totalPct !== 100 && allocationsDirty && Object.keys(pendingAllocations).some((k) => k.startsWith(`${job.id}:`))
                            return allocationsDirty && Object.keys(pendingAllocations).some((k) => k.startsWith(`${job.id}:`)) ? (
                              <div className="mt-3 flex items-center gap-3 flex-wrap">
                                <button onClick={() => saveAllocations(job)} disabled={allocMutation.isPending || isOver}
                                  className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5 rounded transition-colors">
                                  {allocMutation.isPending ? 'Saving…' : 'Save allocations'}
                                </button>
                                <button onClick={() => { setPendingAllocations((p) => {
                                  const next = { ...p }
                                  Object.keys(next).filter((k) => k.startsWith(`${job.id}:`)).forEach((k) => delete next[k])
                                  return next
                                }); setAllocationsDirty(false) }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Discard</button>
                                {isOver && <span className="text-amber-400 text-xs">Total is {totalPct}% — must equal 100%</span>}
                                {allocError && <span className="text-red-400 text-xs">{allocError}</span>}
                              </div>
                            ) : null
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Monthly Overrides tab ────────────────────────────────────────── */}
          {activeTab === 'overrides' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Monthly Overrides</h2>
                <p className="text-xs text-gray-500">Override a specific month's salary for any job</p>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">Add a job first to create overrides.</div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => {
                    const overrides = allJobsOverrides[job.id] ?? []
                    return (
                      <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-white font-medium">{job.name}</h3>
                            {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                          </div>
                          <button onClick={() => { setOverrideJobId(job.id); setOverrideForm(emptyOverride); setOverrideError('') }}
                            className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                            + Add override
                          </button>
                        </div>

                        {overrides.length === 0 ? (
                          <p className="text-gray-600 text-sm">No overrides for this job.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                                <th className="pb-2 pr-4">Month</th>
                                <th className="pb-2 pr-4">Gross</th>
                                <th className="pb-2 pr-4">Net</th>
                                <th className="pb-2 pr-4">Note</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {overrides.map((o) => (
                                <tr key={o.id} className="border-b border-gray-800/50 last:border-0">
                                  <td className="py-2 pr-4 text-white">{MONTHS[o.month - 1]} {o.year}</td>
                                  <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(o.grossAmount)}</td>
                                  <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(o.netAmount)}</td>
                                  <td className="py-2 pr-4 text-gray-500 text-xs">{o.note ?? '—'}</td>
                                  <td className="py-2">
                                    <button onClick={() => setConfirmDeleteOverride({ jobId: job.id, overrideId: o.id })}
                                      className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Bonuses tab ──────────────────────────────────────────────────── */}
          {activeTab === 'bonuses' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Bonuses</h2>
                <p className="text-xs text-gray-500">Track one-off and spread-annually bonuses</p>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">Add a job first to track bonuses.</div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => {
                    const bonuses = allJobsBonuses[job.id] ?? []
                    return (
                      <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-white font-medium">{job.name}</h3>
                            {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                          </div>
                          <button onClick={() => { setBonusJobId(job.id); setBonusForm(emptyBonus); setBonusError('') }}
                            className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                            + Add bonus
                          </button>
                        </div>

                        {bonuses.length === 0 ? (
                          <p className="text-gray-600 text-sm">No bonuses for this job.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                                <th className="pb-2 pr-4">Label</th>
                                <th className="pb-2 pr-4">Payment date</th>
                                <th className="pb-2 pr-4">Net</th>
                                <th className="pb-2 pr-4">In budget</th>
                                <th className="pb-2 pr-4">Mode</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {bonuses.map((b) => (
                                <tr key={b.id} className="border-b border-gray-800/50 last:border-0">
                                  <td className="py-2 pr-4 text-white">{b.label}</td>
                                  <td className="py-2 pr-4 text-gray-300">{fmtDate(b.paymentDate)}</td>
                                  <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(b.netAmount)}</td>
                                  <td className="py-2 pr-4">
                                    {b.includeInBudget
                                      ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Yes</span>
                                      : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">No</span>
                                    }
                                  </td>
                                  <td className="py-2 pr-4 text-gray-400 text-xs">
                                    {b.budgetMode === 'ONE_OFF' ? 'One-off' : b.budgetMode === 'SPREAD_ANNUALLY' ? 'Spread / year' : '—'}
                                  </td>
                                  <td className="py-2">
                                    <div className="flex gap-3">
                                      <button onClick={() => { setEditingBonus(b); setBonusForm({ label: b.label, grossAmount: b.grossAmount, netAmount: b.netAmount, paymentDate: toDateInput(b.paymentDate), includeInBudget: b.includeInBudget, budgetMode: b.budgetMode ?? '' }); setBonusError('') }}
                                        className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                                      <button onClick={() => setConfirmDeleteBonus({ jobId: job.id, bonusId: b.id })}
                                        className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Add/Edit Job modal ──────────────────────────────────────────────── */}
      {(showAddJob || editingJob) && (
        <Modal title={editingJob ? 'Edit job' : 'Add job'} onClose={() => { setShowAddJob(false); setEditingJob(null) }}>
          <form onSubmit={handleJobSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Job title</label>
              <input type="text" value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                required autoFocus placeholder="e.g. Software Engineer" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Employer <span className="text-gray-600">(optional)</span></label>
              <input type="text" value={jobForm.employer} onChange={(e) => setJobForm({ ...jobForm, employer: e.target.value })}
                placeholder="e.g. Acme Corp" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Start date</label>
                <input type="date" value={jobForm.startDate} onChange={(e) => setJobForm({ ...jobForm, startDate: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">End date <span className="text-gray-600">(optional)</span></label>
                <input type="date" value={jobForm.endDate} onChange={(e) => setJobForm({ ...jobForm, endDate: e.target.value })}
                  className={inputClass} />
              </div>
            </div>
            {jobFormError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{jobFormError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={createJobMutation.isPending || updateJobMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {createJobMutation.isPending || updateJobMutation.isPending ? 'Saving…' : editingJob ? 'Save changes' : 'Add job'}
              </button>
              <button type="button" onClick={() => { setShowAddJob(false); setEditingJob(null) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Salary History modal ────────────────────────────────────────────── */}
      {salaryJobId && (
        <Modal title={`Salary history — ${jobs.find((j) => j.id === salaryJobId)?.name}`} onClose={() => setSalaryJobId(null)} maxWidth="max-w-lg">
          {/* Existing records */}
          {salaryRecords.length > 0 && (
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                  <th className="pb-2 pr-4">Effective from</th>
                  <th className="pb-2 pr-4">Gross / month</th>
                  <th className="pb-2">Net / month</th>
                </tr>
              </thead>
              <tbody>
                {salaryRecords.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-2 pr-4 text-gray-300">{fmtDate(r.effectiveFrom)}</td>
                    <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(r.grossAmount)}</td>
                    <td className="py-2 text-amber-400 tabular-nums">{fmt(r.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add new record */}
          <h3 className="text-sm font-medium text-gray-400 mb-3">Add salary record</h3>
          <form onSubmit={(e) => { e.preventDefault(); addSalaryMutation.mutate(salaryForm) }} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Effective from</label>
                <input type="date" value={salaryForm.effectiveFrom} onChange={(e) => setSalaryForm({ ...salaryForm, effectiveFrom: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
                <input type="number" value={salaryForm.grossAmount} onChange={(e) => setSalaryForm({ ...salaryForm, grossAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
                <input type="number" value={salaryForm.netAmount} onChange={(e) => setSalaryForm({ ...salaryForm, netAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
            </div>
            {salaryError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{salaryError}</div>}
            <button type="submit" disabled={addSalaryMutation.isPending}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
              {addSalaryMutation.isPending ? 'Saving…' : 'Add record'}
            </button>
          </form>
        </Modal>
      )}

      {/* ── Add Override modal ──────────────────────────────────────────────── */}
      {overrideJobId && (
        <Modal title={`Add monthly override — ${jobs.find((j) => j.id === overrideJobId)?.name}`} onClose={() => setOverrideJobId(null)}>
          <form onSubmit={(e) => { e.preventDefault(); upsertOverrideMutation.mutate(overrideForm) }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
                <input type="number" value={overrideForm.year} onChange={(e) => setOverrideForm({ ...overrideForm, year: e.target.value })}
                  required min="2000" max="2100" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
                <select value={overrideForm.month} onChange={(e) => setOverrideForm({ ...overrideForm, month: e.target.value })} className={inputClass}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
                <input type="number" value={overrideForm.grossAmount} onChange={(e) => setOverrideForm({ ...overrideForm, grossAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
                <input type="number" value={overrideForm.netAmount} onChange={(e) => setOverrideForm({ ...overrideForm, netAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Note <span className="text-gray-600">(optional)</span></label>
              <input type="text" value={overrideForm.note} onChange={(e) => setOverrideForm({ ...overrideForm, note: e.target.value })}
                placeholder="e.g. Sick leave, parental leave" className={inputClass} />
            </div>
            {overrideError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{overrideError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={upsertOverrideMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {upsertOverrideMutation.isPending ? 'Saving…' : 'Save override'}
              </button>
              <button type="button" onClick={() => setOverrideJobId(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add/Edit Bonus modal ────────────────────────────────────────────── */}
      {(bonusJobId || editingBonus) && (
        <Modal title={editingBonus ? 'Edit bonus' : `Add bonus — ${jobs.find((j) => j.id === bonusJobId)?.name}`} onClose={() => { setBonusJobId(null); setEditingBonus(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); if (editingBonus) updateBonusMutation.mutate(bonusForm); else createBonusMutation.mutate(bonusForm) }} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
              <input type="text" value={bonusForm.label} onChange={(e) => setBonusForm({ ...bonusForm, label: e.target.value })}
                required autoFocus placeholder="e.g. Annual bonus" className={inputClass} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Payment date</label>
                <input type="date" value={bonusForm.paymentDate} onChange={(e) => setBonusForm({ ...bonusForm, paymentDate: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Gross amount</label>
                <input type="number" value={bonusForm.grossAmount} onChange={(e) => setBonusForm({ ...bonusForm, grossAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Net amount</label>
                <input type="number" value={bonusForm.netAmount} onChange={(e) => setBonusForm({ ...bonusForm, netAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bonusForm.includeInBudget} onChange={(e) => setBonusForm({ ...bonusForm, includeInBudget: e.target.checked })}
                  className="rounded border-gray-600" />
                <span className="text-sm text-gray-300">Include in budget calculations</span>
              </label>
            </div>
            {bonusForm.includeInBudget && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">Budget mode</label>
                <div className="flex gap-3">
                  {(['ONE_OFF', 'SPREAD_ANNUALLY'] as BudgetMode[]).map((val) => {
                    const label = val === 'ONE_OFF' ? 'One-off (appears in payment month)' : 'Spread annually (÷12 per month)'
                    return (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" value={val} checked={bonusForm.budgetMode === val} onChange={() => setBonusForm({ ...bonusForm, budgetMode: val })}
                        className="border-gray-600" />
                      <span className="text-sm text-gray-300">{label}</span>
                    </label>
                    )
                  })}
                </div>
              </div>
            )}
            {bonusError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{bonusError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={createBonusMutation.isPending || updateBonusMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {createBonusMutation.isPending || updateBonusMutation.isPending ? 'Saving…' : editingBonus ? 'Save changes' : 'Add bonus'}
              </button>
              <button type="button" onClick={() => { setBonusJobId(null); setEditingBonus(null) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Confirm close job ───────────────────────────────────────────────── */}
      {confirmCloseJob && (
        <Modal title="Close job" onClose={() => setConfirmCloseJob(null)}>
          <p className="text-gray-300 text-sm mb-6">
            Close <span className="font-semibold text-white">{confirmCloseJob.name}</span>? This will set today as the end date. You can re-open it by editing the job.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { closeJobMutation.mutate(confirmCloseJob.id); setConfirmCloseJob(null) }}
              disabled={closeJobMutation.isPending}
              className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Close job
            </button>
            <button onClick={() => setConfirmCloseJob(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Confirm delete bonus ────────────────────────────────────────────── */}
      {confirmDeleteBonus && (
        <Modal title="Delete bonus" onClose={() => setConfirmDeleteBonus(null)}>
          <p className="text-gray-300 text-sm mb-6">Delete this bonus? This action cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { deleteBonusMutation.mutate(confirmDeleteBonus); setConfirmDeleteBonus(null) }}
              disabled={deleteBonusMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Delete
            </button>
            <button onClick={() => setConfirmDeleteBonus(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Confirm delete override ─────────────────────────────────────────── */}
      {confirmDeleteOverride && (
        <Modal title="Delete override" onClose={() => setConfirmDeleteOverride(null)}>
          <p className="text-gray-300 text-sm mb-6">Delete this monthly override? This action cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { deleteOverrideMutation.mutate(confirmDeleteOverride); setConfirmDeleteOverride(null) }}
              disabled={deleteOverrideMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Delete
            </button>
            <button onClick={() => setConfirmDeleteOverride(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
