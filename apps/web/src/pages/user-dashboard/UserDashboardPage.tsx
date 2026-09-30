import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { PiggyBank } from 'lucide-react'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useUserMe } from '../../api/queries'
import { Modal } from '../../components/Modal'
import { PageLoader } from '../../components/LoadingSpinner'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn, secondaryBtn, primaryBtnSm, segmentGroup, segmentBtn } from '../../lib/styles'
import { useFmt, useBaseCurrency } from '../../hooks/useFmt'
import { PrimaryTiles } from './PrimaryTiles'
import { HouseholdCard } from './HouseholdCard'
import { IncomeFlowCard, IncomeTrendCard } from './IncomeDetail'
import type { IncomeSankeyData, IncomeTrend, NewHousehold, PersonalDashboard, UserSummary } from './types'
import { Page } from '../../components/Page'
import { Widget, WidgetGrid } from '../../components/WidgetGrid'
import { EmptyState } from '../../components/EmptyState'

/** Personal dashboard: income/expense/savings tiles, households and income detail. */
export function UserDashboardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState('')
  const [showGross, setShowGross] = useState(true)
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')

  const scale = period === 'annual' ? 12 : 1
  const periodLabel = period === 'annual' ? '/ year' : '/ month'
  function pfmt(v: number | string) { return fmt(parseFloat(String(v)) * scale) }

  const { data: dashboard, isLoading: dashLoading } = useQuery<PersonalDashboard>({
    queryKey: qk.meDashboard(),
    queryFn: async () => (await api.get<PersonalDashboard>('/users/me/dashboard')).data,
  })

  const { data: summary, isLoading: summaryLoading } = useQuery<UserSummary>({
    queryKey: qk.meSummary(),
    queryFn: async () => (await api.get<UserSummary>('/me/summary')).data,
  })

  const { data: me } = useUserMe()

  const { data: incomeTrend } = useQuery<IncomeTrend>({
    queryKey: qk.incomeTrendMe(),
    queryFn: async () => (await api.get<IncomeTrend>('/users/me/income/trend')).data,
  })

  const { data: sankeyData } = useQuery<IncomeSankeyData>({
    queryKey: qk.incomeSankeyMe(),
    queryFn: async () => (await api.get<IncomeSankeyData>('/users/me/income/sankey')).data,
  })

  const showSparklines = me?.preferences?.showDashboardSparklines ?? true

  const createMutation = useMutation({
    mutationFn: (householdName: string) => api.post<NewHousehold>('/households', { name: householdName }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.meSummary() })
      setShowCreate(false)
      setName('')
      navigate(`/households/${res.data.id}`)
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setCreateError((err.response?.data as { error?: string })?.error ?? 'Failed to create household')
      }
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    createMutation.mutate(name)
  }

  const { households = [] } = summary ?? {}
  const isLoading = dashLoading || summaryLoading

  return (
    <div className="flex-1 flex flex-col">
      <Page template="dashboard">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="font-display text-3xl leading-tight text-white">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Your personal financial snapshot</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={segmentGroup}>
              <button
                onClick={() => setPeriod('monthly')}
                className={segmentBtn(period === 'monthly')}
              >Monthly</button>
              <button
                onClick={() => setPeriod('annual')}
                className={segmentBtn(period === 'annual')}
              >Annual</button>
            </div>
            {me?.role === 'SYSTEM_ADMIN' && (
              <button
                onClick={() => { setShowCreate(true); setCreateError('') }}
                className={primaryBtnSm}
              >
                + New household
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : (
          <>
            {/* Spans per column count (2 / 3 / 4 / 6); on 4K everything fits on one screen */}
            <WidgetGrid>
              {/* ── Four primary tiles ── */}
              <Widget span={{ 2: 2, 3: 3, 4: 4, 6: 6 }}>
                <PrimaryTiles dashboard={dashboard} showSparklines={showSparklines} pfmt={pfmt} periodLabel={periodLabel} />
              </Widget>

              {/* ── Households ── */}
              <Widget span={{ 2: 2, 3: 3, 4: 2, 6: 2 }}>
                <div className="flex flex-col">
                  <h2 className="text-base font-semibold text-gray-200 mb-4">Your households</h2>
                  {households.length === 0 ? (
                    <EmptyState
                      icon={<PiggyBank size={36} strokeWidth={1.5} />}
                      title="No households yet"
                      aside="Every ship needs a crew. Create a household to begin."
                    />
                  ) : (
                    <div className="space-y-3">
                      {households.map((h) => (
                        <HouseholdCard key={h.id} household={h} onClick={() => navigate(`/households/${h.id}`)} fmt={pfmt} periodLabel={periodLabel} />
                      ))}
                    </div>
                  )}
                </div>
              </Widget>

              {/* ── Income detail (Sankey + 12-month trend) ── */}
              <Widget span={{ 2: 2, 3: 3, 4: 2, 6: 2 }}>
                <IncomeFlowCard sankeyData={sankeyData} baseCurrency={baseCurrency} />
              </Widget>
              <Widget span={{ 2: 2, 3: 3, 4: 4, 6: 2 }}>
                <IncomeTrendCard incomeTrend={incomeTrend} showGross={showGross} setShowGross={setShowGross} fmt={fmt} />
              </Widget>
            </WidgetGrid>

            <div className="pt-6 pb-2">
              <Link to="/income" className="text-amber-400 hover:text-amber-300 text-sm transition-colors">
                Manage jobs &amp; salary →
              </Link>
            </div>
          </>
        )}
      </Page>

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
            <FormError message={createError} />
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className={`flex-1 ${primaryBtn}`}
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className={`flex-1 ${secondaryBtn}`}
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
