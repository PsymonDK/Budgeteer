import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, Dot,
} from 'recharts'
import { sankey, sankeyLinkHorizontal, SankeyNode, SankeyLink } from 'd3-sankey'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AlertTriangle, User, TrendingUp, Home } from 'lucide-react'
import Avatar from '../components/Avatar'
import { PageLoader } from '../components/LoadingSpinner'

// ── Shared styles ────────────────────────────────────────────────────────────

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors text-sm'

const cardClass = 'bg-gray-900 border border-gray-800 rounded-xl p-6'

// ── Types ────────────────────────────────────────────────────────────────────

interface UserMe {
  id: string
  email: string
  name: string
  role: string
  avatarUrl?: string | null
  preferences: {
    preferredCurrency: string
    defaultHouseholdId: string | null
    notifyOverAllocation: boolean
    notifyExpensesExceedIncome: boolean
    notifyNoSavings: boolean
    notifyUncategorised: boolean
  } | null
}

interface Currency {
  currencyCode: string
  name?: string
}

interface Household {
  id: string
  name: string
  myRole: string | null
  members?: unknown[]
}

interface IncomeSummary {
  totalMonthly: string
  totalAllocated: string
  totalUnallocated: string
  allocationPct: string
  overAllocated: boolean
}

interface IncomeTrend {
  months: string[]
  jobs: { id: string; name: string; monthly: number[] }[]
  total: number[]
  bonuses: { jobId: string; month: string; amount: number; label: string }[]
}

interface SankeyNodeDef {
  id: string
  name: string
  color?: string
}

interface SankeyLinkDef {
  source: string
  target: string
  value: number
}

interface IncomeSankeyData {
  totalIncome: string
  nodes: SankeyNodeDef[]
  links: SankeyLinkDef[]
}

// ── Job color palette (same as backend) ─────────────────────────────────────

const JOB_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16',
]

// ── Tab 1: Profile ───────────────────────────────────────────────────────────

function ProfileTab(_props: { user: ReturnType<typeof useAuth>['user'] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: me, isLoading } = useQuery<UserMe>({
    queryKey: ['users-me'],
    queryFn: async () => (await api.get<UserMe>('/users/me')).data,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [profileError, setProfileError] = useState('')
  const [prefError, setPrefError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (me) {
      setName(me.name)
      setEmail(me.email)
    }
  }, [me])

  const emailChanged = me && email !== me.email
  const showPasswordConfirm = !!emailChanged

  const updateMeMutation = useMutation({
    mutationFn: (body: { name?: string; email?: string; currentPassword?: string }) =>
      api.put('/users/me', body),
    onSuccess: () => {
      setProfileError('')
      setCurrentPassword('')
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      toast.success('Profile updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setProfileError((err.response?.data as { error?: string })?.error ?? 'Failed to update profile')
      }
    },
  })

  const updatePrefsMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/users/me/preferences', body),
    onSuccess: () => {
      setPrefError('')
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      toast.success('Preferences saved')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setPrefError((err.response?.data as { error?: string })?.error ?? 'Failed to save preferences')
      }
    },
  })

  async function handleAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarError('')
    const form = new FormData()
    form.append('avatar', file)
    try {
      await api.post('/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.success('Avatar updated')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setAvatarError((err.response?.data as { error?: string })?.error ?? 'Failed to upload avatar')
      }
    }
  }

  async function handleAvatarDelete() {
    setAvatarError('')
    try {
      await api.delete('/users/me/avatar')
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.success('Avatar removed')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setAvatarError((err.response?.data as { error?: string })?.error ?? 'Failed to remove avatar')
      }
    }
  }

  function handleProfileSubmit(e: FormEvent) {
    e.preventDefault()
    setProfileError('')
    const body: { name?: string; email?: string; currentPassword?: string } = {}
    if (me && name !== me.name) body.name = name
    if (me && email !== me.email) {
      body.email = email
      body.currentPassword = currentPassword
    }
    if (Object.keys(body).length === 0) return
    updateMeMutation.mutate(body)
  }

  function handlePrefChange(field: string, value: unknown) {
    updatePrefsMutation.mutate({ [field]: value })
  }

  if (isLoading || !me) {
    return <PageLoader />
  }

  const prefs = me.preferences

  return (
    <div className="space-y-6">
      {/* Personal info */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">Personal information</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-5">
          <Avatar user={me} size={40} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="text-sm text-amber-400 hover:text-amber-300 transition-colors"
            >
              Upload photo
            </button>
            {me.avatarUrl && (
              <button
                type="button"
                onClick={handleAvatarDelete}
                className="text-sm text-gray-500 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        {avatarError && <p className="text-red-400 text-xs mb-3">{avatarError}</p>}

        <form onSubmit={handleProfileSubmit} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          {showPasswordConfirm && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Confirm current password <span className="text-amber-400">(required to change email)</span>
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className={inputClass}
              />
            </div>
          )}
          {profileError && (
            <p className="text-red-400 text-xs">{profileError}</p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={updateMeMutation.isPending}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {updateMeMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/change-password')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Change password
            </button>
          </div>
        </form>
      </div>

      {/* Preferences */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">Preferences</h2>
        <div className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Preferred currency</label>
            <select
              value={prefs?.preferredCurrency ?? 'DKK'}
              onChange={(e) => handlePrefChange('preferredCurrency', e.target.value)}
              className={inputClass}
            >
              {currencies.length === 0 && (
                <option value={prefs?.preferredCurrency ?? 'DKK'}>
                  {prefs?.preferredCurrency ?? 'DKK'}
                </option>
              )}
              {currencies.map((c) => (
                <option key={c.currencyCode} value={c.currencyCode}>
                  {c.currencyCode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Default household</label>
            <select
              value={prefs?.defaultHouseholdId ?? ''}
              onChange={(e) => handlePrefChange('defaultHouseholdId', e.target.value || null)}
              className={inputClass}
            >
              <option value="">— None —</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3 pt-2">
            <p className="text-xs font-medium text-gray-400">Notifications</p>
            {[
              { field: 'notifyOverAllocation', label: 'Over-allocation warning' },
              { field: 'notifyExpensesExceedIncome', label: 'Expenses exceed income' },
              { field: 'notifyNoSavings', label: 'No savings entries' },
              { field: 'notifyUncategorised', label: 'Uncategorised expenses' },
            ].map(({ field, label }) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs?.[field as keyof typeof prefs] as boolean ?? false}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handlePrefChange(field, e.target.checked)
                  }
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>

          {prefError && <p className="text-red-400 text-xs">{prefError}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Income ────────────────────────────────────────────────────────────

function formatMonth(yyyymm: string): string {
  const [year, mon] = yyyymm.split('-')
  const date = new Date(Number(year), Number(mon) - 1, 1)
  return date.toLocaleString('en-GB', { month: 'short', year: '2-digit' })
}

function fmt(val: string | number): string {
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function IncomeTab() {
  // Summary
  const { data: summary } = useQuery<IncomeSummary>({
    queryKey: ['income-summary-me'],
    queryFn: async () => (await api.get<IncomeSummary>('/users/me/income/summary')).data,
  })

  // Trend
  const { data: trend } = useQuery<IncomeTrend>({
    queryKey: ['income-trend-me'],
    queryFn: async () => (await api.get<IncomeTrend>('/users/me/income/trend')).data,
  })

  // Sankey
  const { data: sankeyData } = useQuery<IncomeSankeyData>({
    queryKey: ['income-sankey-me'],
    queryFn: async () => (await api.get<IncomeSankeyData>('/users/me/income/sankey')).data,
  })

  // Build recharts data from trend
  const chartData = trend
    ? trend.months.map((m, i) => {
        const row: Record<string, unknown> = { month: formatMonth(m), monthKey: m, total: trend.total[i] }
        trend.jobs.forEach((j) => {
          row[j.name] = j.monthly[i]
        })
        return row
      })
    : []

  const bonusMap = new Map<string, { jobId: string; amount: number; label: string }[]>()
  if (trend) {
    for (const b of trend.bonuses) {
      const key = `${b.jobId}::${b.month}`
      const arr = bonusMap.get(key) ?? []
      arr.push({ jobId: b.jobId, amount: b.amount, label: b.label })
      bonusMap.set(key, arr)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Monthly total', value: summary.totalMonthly, warn: false },
            { label: 'Allocated', value: summary.totalAllocated, warn: false },
            { label: 'Unallocated', value: summary.totalUnallocated, warn: false },
            {
              label: 'Allocation %',
              value: summary.allocationPct + '%',
              warn: summary.overAllocated,
              warnMsg: 'Over-allocated',
            },
          ].map(({ label, value, warn, warnMsg }) => (
            <div key={label} className={`${cardClass} relative`}>
              {warn && (
                <span className="absolute top-3 right-3 flex items-center gap-1 bg-red-900/60 text-red-300 text-xs px-2 py-0.5 rounded-full">
                  <AlertTriangle size={10} />
                  {warnMsg}
                </span>
              )}
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className={`text-xl font-semibold ${warn ? 'text-red-400' : 'text-white'}`}>
                {typeof value === 'string' && value.includes('%') ? value : fmt(value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Trend chart */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">12-month income trend</h2>
        {trend && trend.jobs.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#f3f4f6' }}
                itemStyle={{ color: '#d1d5db' }}
              />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
              {trend.jobs.map((job, i) => (
                <Line
                  key={job.id}
                  type="monotone"
                  dataKey={job.name}
                  stroke={JOB_COLORS[i % JOB_COLORS.length]}
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props
                    const monthKey = payload.monthKey as string
                    const hasBonuses = bonusMap.has(`${job.id}::${monthKey}`)
                    if (hasBonuses) {
                      const bonuses = bonusMap.get(`${job.id}::${monthKey}`)!
                      const tipText = bonuses.map((b) => `${b.label}: ${fmt(b.amount)}`).join(', ')
                      return (
                        <g key={`dot-${job.id}-${monthKey}`}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={6}
                            fill={JOB_COLORS[i % JOB_COLORS.length]}
                            stroke="#fff"
                            strokeWidth={1.5}
                          />
                          <title>{`Bonus: ${tipText}`}</title>
                        </g>
                      )
                    }
                    return <Dot key={`dot-${job.id}-${monthKey}`} {...props} r={3} />
                  }}
                />
              ))}
              <Line
                type="monotone"
                dataKey="total"
                stroke="#ffffff"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Total"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-sm">No job income data found.</p>
        )}
      </div>

      {/* Sankey diagram */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">Income flow</h2>
        {sankeyData && sankeyData.nodes.length > 0 ? (
          <SankeyChart data={sankeyData} />
        ) : (
          <p className="text-gray-500 text-sm">No allocation data to display. Allocate income to households first.</p>
        )}
      </div>

      {/* Link to income management */}
      <div>
        <Link to="/income" className="text-amber-400 hover:text-amber-300 text-sm transition-colors">
          Manage jobs &amp; salary →
        </Link>
      </div>
    </div>
  )
}

// ── Sankey SVG component ─────────────────────────────────────────────────────

interface SankeyExtNode extends SankeyNodeDef {
  x0?: number; x1?: number; y0?: number; y1?: number; index?: number
}

interface SankeyExtLink {
  source: SankeyExtNode
  target: SankeyExtNode
  value: number
  width?: number
  y0?: number; y1?: number
}

function SankeyChart({ data }: { data: IncomeSankeyData }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgContent, setSvgContent] = useState<{
    nodes: SankeyExtNode[]
    links: SankeyExtLink[]
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    const width = containerRef.current?.clientWidth ?? 800
    const height = 400

    // Map node ids to indices
    const nodeIndexMap = new Map(data.nodes.map((n, i) => [n.id, i]))

    const sankeyNodes: SankeyExtNode[] = data.nodes.map((n) => ({ ...n }))
    const sankeyLinks = data.links
      .filter((l) => nodeIndexMap.has(l.source) && nodeIndexMap.has(l.target) && l.value > 0)
      .map((l) => ({
        source: nodeIndexMap.get(l.source)!,
        target: nodeIndexMap.get(l.target)!,
        value: l.value,
      }))

    if (sankeyNodes.length === 0 || sankeyLinks.length === 0) {
      setSvgContent(null)
      return
    }

    try {
      const layout = sankey<SankeyExtNode, { source: number; target: number; value: number }>()
        .nodeId((d) => d.index ?? 0)
        .nodeWidth(18)
        .nodePadding(12)
        .extent([[1, 1], [width - 1, height - 6]])

      const graph = layout({
        nodes: sankeyNodes.map((d, i) => ({ ...d, index: i })),
        links: sankeyLinks,
      })

      setSvgContent({
        nodes: graph.nodes as unknown as SankeyExtNode[],
        links: graph.links as unknown as SankeyExtLink[],
        width,
        height,
      })
    } catch {
      setSvgContent(null)
    }
  }, [data])

  // Build color map by node id
  const colorMap = new Map(data.nodes.map((n, i) => [n.id, n.color ?? JOB_COLORS[i % JOB_COLORS.length]]))

  if (!svgContent) {
    // Fallback table
    return (
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="text-gray-400 border-b border-gray-800">
              <th className="text-left py-2 pr-4">Flow</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.links.map((l, i) => {
              const srcName = data.nodes.find((n) => n.id === l.source)?.name ?? l.source
              const tgtName = data.nodes.find((n) => n.id === l.target)?.name ?? l.target
              return (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-1.5 pr-4 text-gray-300">{srcName} → {tgtName}</td>
                  <td className="py-1.5 text-right text-white">{fmt(l.value)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const { nodes, links, width, height } = svgContent
  const linkPath = sankeyLinkHorizontal()

  return (
    <div ref={containerRef}>
      <svg width={width} height={height} style={{ fontFamily: 'inherit' }}>
        {/* Links */}
        {links.map((link, i) => {
          const srcId = (link.source as unknown as SankeyExtNode).id
          const color = colorMap.get(srcId) ?? '#6b7280'
          const d = linkPath(link as unknown as SankeyLink<SankeyNode<SankeyExtNode, SankeyExtLink>, SankeyExtLink>)
          return (
            <path
              key={i}
              d={d ?? ''}
              fill="none"
              stroke={color}
              strokeOpacity={0.35}
              strokeWidth={Math.max(1, link.width ?? 1)}
              style={{ cursor: 'default' }}
            >
              <title>{`${(link.source as unknown as SankeyExtNode).name} → ${(link.target as unknown as SankeyExtNode).name}: ${fmt(link.value)}`}</title>
            </path>
          )
        })}

        {/* Nodes */}
        {nodes.map((node, i) => {
          const x0 = node.x0 ?? 0
          const x1 = node.x1 ?? 0
          const y0 = node.y0 ?? 0
          const y1 = node.y1 ?? 0
          const color = colorMap.get(node.id) ?? JOB_COLORS[i % JOB_COLORS.length]
          const isLeft = x0 < width / 2
          return (
            <g key={node.id}>
              <rect
                x={x0}
                y={y0}
                height={Math.max(1, y1 - y0)}
                width={x1 - x0}
                fill={color}
                fillOpacity={0.9}
                rx={2}
              >
                <title>{`${node.name}: ${fmt((node as unknown as { value?: number }).value ?? 0)}`}</title>
              </rect>
              <text
                x={isLeft ? x1 + 6 : x0 - 6}
                y={(y0 + y1) / 2}
                textAnchor={isLeft ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize={11}
                fill="#d1d5db"
              >
                {node.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Tab 3: Households ────────────────────────────────────────────────────────

function HouseholdsTab() {
  const { data: summary } = useQuery<IncomeSummary>({
    queryKey: ['income-summary-me'],
    queryFn: async () => (await api.get<IncomeSummary>('/users/me/income/summary')).data,
  })

  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  return (
    <div className="space-y-6">
      {summary?.overAllocated && (
        <div className="flex items-center gap-3 bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            Your income is over-allocated ({summary.allocationPct}%). Review your allocations on the{' '}
            <Link to="/income" className="underline hover:text-red-200">Income page</Link>.
          </span>
        </div>
      )}

      {isLoading ? (
        <PageLoader />
      ) : households.length === 0 ? (
        <div className={cardClass}>
          <p className="text-gray-400 text-sm">
            You are not a member of any household.{' '}
            <Link to="/" className="text-amber-400 hover:text-amber-300">Go to households →</Link>
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {households.map((hh) => (
            <div key={hh.id} className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold">{hh.name}</h3>
                    {hh.myRole && (
                      <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        {hh.myRole}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    <Link to={`/households/${hh.id}`} className="text-amber-400 hover:text-amber-300">
                      Open household →
                    </Link>
                  </p>
                </div>
                <Link
                  to={`/households/${hh.id}`}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <Home size={18} />
                </Link>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                To view or edit income allocations for this household,{' '}
                <Link to="/income" className="text-amber-400 hover:text-amber-300">
                  go to the Income page →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ProfilePage ─────────────────────────────────────────────────────────

type TabKey = 'profile' | 'income' | 'households'

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'income', label: 'Income', icon: TrendingUp },
  { key: 'households', label: 'Households', icon: Home },
]

export function ProfilePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Page content */}
      <main className="flex-1 px-6 py-8 max-w-4xl w-full mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Your profile</h1>

        {/* Tab bar */}
        <div className="border-b border-gray-800 mb-6">
          <nav className="flex gap-0 -mb-px">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {tab === 'profile' && <ProfileTab user={user} />}
        {tab === 'income' && <IncomeTab />}
        {tab === 'households' && <HouseholdsTab />}
      </main>
    </div>
  )
}
