import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useHouseholdDetail, useReceiptSummary } from '../../api/queries'
import { useAuth } from '../../contexts/AuthContext'
import { PageLoader } from '../../components/LoadingSpinner'
import { SankeyChart } from '../../components/SankeyChart'
import { MonthItemsPanel } from '../../components/MonthItemsPanel'
import { useFmt, useBaseCurrency } from '../../hooks/useFmt'
import { useTransfers, type BudgetTransfer } from '../../hooks/useTransfers'
import { useTransferBreakdown } from '../../hooks/useTransferBreakdown'
import { getApiError } from '../../lib/apiError'
import { toLocalISODate, startOfLocalMonthISO } from '../../lib/dates'
import { buildIncomeSankey, buildReceiptSankey } from './sankey'
import { SummaryCards } from './SummaryCards'
import { ReceiptFlowSection } from './ReceiptFlowSection'
import { MemberObligations } from './MemberObligations'
import { AffordabilityCalculator, SavingsRateHistory } from './SavingsSections'
import { AccountBreakdown, CategoryBreakdown, ExpenseList } from './ExpenseBreakdown'
import { MarkPaidDialog, TransferByAccount, TransferHistory, TransferTile } from './Transfers'
import type { DashboardSummary, SavingsHistoryRow } from './types'
import type { ReceiptSummaryPeriod } from '../../api/types'
import { Page } from '../../components/Page'
import { Widget, WidgetGrid } from '../../components/WidgetGrid'
import { StatusBadge } from '../../components/StatusBadge'
import { statusLabel } from '../../lib/budgetYear'
import { TriangleAlert, X } from 'lucide-react'

export function DashboardPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()

  // DASH-002: monthly vs actual charge toggle
  const [expenseView, setExpenseView] = useState<'monthly' | 'actual'>('monthly')

  // DASH-003: dismissed warning keys
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // SAV-003: affordability slider (extra monthly savings)
  const [extraSavings, setExtraSavings] = useState(0)
  const [receiptPeriod, setReceiptPeriod] = useState<ReceiptSummaryPeriod>('currentMonth')
  const [receiptStartDate, setReceiptStartDate] = useState(() => startOfLocalMonthISO())
  const [receiptEndDate, setReceiptEndDate] = useState(() => toLocalISODate())

  // Budget transfer state
  const [markPaidTransfer, setMarkPaidTransfer] = useState<BudgetTransfer | null>(null)
  const [markPaidAmount, setMarkPaidAmount] = useState('')
  const [markPaidLoading, setMarkPaidLoading] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)

  const { data: household } = useHouseholdDetail(householdId)

  const { data: savingsHistory = [] } = useQuery<SavingsHistoryRow[]>({
    queryKey: qk.savingsHistory(householdId),
    queryFn: async () => (await api.get<SavingsHistoryRow[]>(`/households/${householdId}/savings-history`)).data,
    enabled: !!householdId,
  })

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: qk.dashboard(householdId),
    queryFn: async () => (await api.get<DashboardSummary>(`/households/${householdId}/summary`)).data,
    enabled: !!householdId,
  })

  const receiptCustomRangeValid = receiptPeriod !== 'custom' || Boolean(receiptStartDate && receiptEndDate && receiptStartDate <= receiptEndDate)

  const { data: receiptSummary } = useReceiptSummary(householdId, receiptPeriod, receiptStartDate, receiptEndDate, { enabled: receiptCustomRangeValid })

  const queryClient = useQueryClient()
  const { data: transfers = [] } = useTransfers(summary?.budgetYear?.id)
  const { data: transferBreakdown } = useTransferBreakdown(summary?.budgetYear?.id)

  const memberBreakdownMap = useMemo(
    () => new Map(transferBreakdown?.byMember.map((m) => [m.userId, m]) ?? []),
    [transferBreakdown],
  )

  // Next pending transfer — the earliest PENDING entry, which may be this month or a future month.
  const nextPending = [...transfers]
    .filter((t) => t.status === 'PENDING')
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0] ?? null

  function openMarkPaid(transfer: BudgetTransfer) {
    setMarkPaidTransfer(transfer)
    setMarkPaidAmount(transfer.calculatedAmount)
  }

  async function handleMarkPaid() {
    if (!markPaidTransfer || !summary?.budgetYear) return
    setMarkPaidLoading(true)
    try {
      await api.patch(
        `/budget-years/${summary.budgetYear.id}/transfers/${markPaidTransfer.id}/mark-paid`,
        { actualAmount: parseFloat(markPaidAmount) },
      )
      queryClient.invalidateQueries({ queryKey: qk.transfers(summary.budgetYear.id) })
      setMarkPaidTransfer(null)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to mark transfer as paid'))
    } finally {
      setMarkPaidLoading(false)
    }
  }

  async function handleRevert(transfer: BudgetTransfer) {
    if (!summary?.budgetYear) return
    try {
      await api.patch(
        `/budget-years/${summary.budgetYear.id}/transfers/${transfer.id}/mark-pending`,
      )
      queryClient.invalidateQueries({ queryKey: qk.transfers(summary.budgetYear.id) })
    } catch (err) {
      toast.error(getApiError(err, 'Failed to revert transfer'))
    }
  }

  function dismiss(key: string) {
    setDismissed((prev) => new Set([...prev, key]))
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const income = parseFloat(summary?.income.totalMonthly ?? '0')
  const expenses = parseFloat(summary?.expenses.totalMonthly ?? '0')
  const savings = parseFloat(summary?.savings.totalMonthly ?? '0')
  const surplus = parseFloat(summary?.surplus ?? '0')

  // SAV-002: savings rate
  const savingsRate = summary?.savingsRate != null ? parseFloat(summary.savingsRate) : null

  // SAV-003: adjusted surplus after extra savings slider
  const adjustedSurplus = useMemo(() => surplus - extraSavings, [surplus, extraSavings])
  const sliderMax = useMemo(() => Math.max(Math.ceil(surplus / 100) * 100, 500), [surplus])

  // VIZ-001: income flow Sankey data
  const sankeyData = useMemo(() => buildIncomeSankey(summary), [summary])

  const receiptSankeyData = useMemo(
    () => buildReceiptSankey(receiptSummary, receiptCustomRangeValid),
    [receiptCustomRangeValid, receiptSummary],
  )

  const warnings = summary?.warnings
  const activeWarnings: { key: string; message: string }[] = []
  if (warnings?.expensesExceedIncome) activeWarnings.push({ key: 'expensesExceedIncome', message: 'Expenses exceed income — review your budget.' })
  if (warnings?.noSavings) activeWarnings.push({ key: 'noSavings', message: 'No savings entries for this budget year.' })
  if (warnings?.unnamedSimulations) activeWarnings.push({ key: 'unnamedSimulations', message: 'You have unnamed budget simulations.' })

  const visibleWarnings = activeWarnings.filter((w) => !dismissed.has(w.key))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Page template="dashboard">

      {/* Budget year badge */}
      {summary?.budgetYear && (
        <div className="mb-5">
          <StatusBadge status={summary.budgetYear.status} shape="pillLg">
            {summary.budgetYear.year} · {statusLabel(summary.budgetYear.status)}
          </StatusBadge>
        </div>
      )}

      <h1 className="font-display text-3xl leading-tight mb-1">{household?.name ?? '…'}</h1>
      <p className="text-gray-400 text-sm mb-6">Dashboard</p>

      {/* DASH-003: Warning banners */}
      {visibleWarnings.length > 0 && (
        <div className="space-y-2 mb-6">
          {visibleWarnings.map((w) => (
            <div
              key={w.key}
              className="flex items-center justify-between gap-3 bg-orange-950/60 border border-orange-800/60 text-orange-200 px-4 py-3 rounded-md text-sm"
            >
              <span className="flex items-center gap-2"><TriangleAlert size={16} className="shrink-0 text-orange-400" aria-hidden="true" />{w.message}</span>
              <button
                onClick={() => dismiss(w.key)}
                aria-label="Dismiss"
                className="p-1 -m-1 text-orange-400 hover:text-orange-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <PageLoader />
      ) : !summary?.budgetYear ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-2">No active budget year for this household.</p>
          <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300 text-sm">
            Set up expenses to create a budget year →
          </Link>
        </div>
      ) : (
        <>
          {/* Spans per column count (2 / 3 / 4 / 6). Order matters: the grid fills gaps with later, smaller tiles. */}
          <WidgetGrid>
            {/* DASH-001: Summary cards */}
            <Widget span={{ 2: 2, 3: 2, 4: 3, 6: 4 }}>
              <SummaryCards
                income={income}
                expenses={expenses}
                savings={savings}
                surplus={surplus}
                savingsRate={savingsRate}
                baseCurrency={baseCurrency}
              />
            </Widget>

            {/* Budget transfer tile — the dashboard's main action, kept next to the summary */}
            <Widget span={{ 2: 2, 3: 1, 4: 1, 6: 2 }}>
              <TransferTile nextPending={nextPending} onMarkPaid={openMarkPaid} fmt={fmt} />
            </Widget>

            {/* HH-005: Member expense splits */}
            {summary.memberSplits.length > 0 && (
              <Widget span={{ 2: 2, 3: 3, 4: 2, 6: 3 }}>
                <MemberObligations
                  memberSplits={summary.memberSplits}
                  meId={me?.id}
                  memberBreakdownMap={memberBreakdownMap}
                  fmt={fmt}
                />
              </Widget>
            )}

            {/* Pay/No-pay: per-item paid checklist for the month */}
            {summary?.budgetYear?.id && (
              <Widget span={{ 2: 2, 3: 3, 4: 2, 6: 3 }}>
                <MonthItemsPanel budgetYearId={summary.budgetYear.id} fmt={fmt} />
              </Widget>
            )}

            {/* VIZ-001: Income flow diagram */}
            {sankeyData && sankeyData.links.length > 0 && (
              <Widget span={{ 2: 2, 3: 3, 4: 4, 6: 4 }}>
                <div className="flex flex-col">
                  <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">Income flow</h2>
                  <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <SankeyChart data={sankeyData} currency={baseCurrency} />
                  </div>
                </div>
              </Widget>
            )}

            <Widget span={{ 2: 2, 3: 2, 4: 2, 6: 3 }}>
              <ExpenseList
                summary={summary}
                expenses={expenses}
                expenseView={expenseView}
                setExpenseView={setExpenseView}
                householdId={householdId}
                fmt={fmt}
              />
            </Widget>
            <Widget span={{ 2: 1, 3: 1, 4: 1, 6: 2 }}>
              <CategoryBreakdown summary={summary} expenses={expenses} fmt={fmt} />
            </Widget>
            <Widget span={{ 2: 1, 3: 1, 4: 1, 6: 1 }}>
              <AccountBreakdown summary={summary} expenses={expenses} fmt={fmt} />
            </Widget>

            {/* SAV-002: Savings rate history */}
            <Widget span={{ 2: 1, 3: 1, 4: 2, 6: 2 }}>
              <SavingsRateHistory savingsHistory={savingsHistory} />
            </Widget>

            {/* SAV-003: Affordability calculator */}
            {surplus > 0 && (
              <Widget span={{ 2: 1, 3: 1, 4: 2, 6: 2 }}>
                <AffordabilityCalculator
                  extraSavings={extraSavings}
                  setExtraSavings={setExtraSavings}
                  sliderMax={sliderMax}
                  adjustedSurplus={adjustedSurplus}
                  savings={savings}
                  income={income}
                  fmt={fmt}
                />
              </Widget>
            )}

            <Widget span={{ 2: 2, 3: 3, 4: 2, 6: 3 }}>
              <ReceiptFlowSection
                receiptSummary={receiptSummary}
                receiptSankeyData={receiptSankeyData}
                receiptPeriod={receiptPeriod}
                setReceiptPeriod={setReceiptPeriod}
                receiptStartDate={receiptStartDate}
                setReceiptStartDate={setReceiptStartDate}
                receiptEndDate={receiptEndDate}
                setReceiptEndDate={setReceiptEndDate}
                receiptCustomRangeValid={receiptCustomRangeValid}
                baseCurrency={baseCurrency}
                fmt={fmt}
              />
            </Widget>

            {/* Transfer history */}
            <Widget span={{ 2: 2, 3: 2, 4: 2, 6: 2 }}>
              <TransferHistory
                transfers={transfers}
                collapsed={historyCollapsed}
                onToggleCollapsed={() => setHistoryCollapsed((c) => !c)}
                onMarkPaid={openMarkPaid}
                onRevert={handleRevert}
                fmt={fmt}
              />
            </Widget>

            {/* Transfer breakdown by account */}
            <Widget span={{ 2: 2, 3: 1, 4: 2, 6: 1 }}>
              <TransferByAccount breakdown={transferBreakdown} fmt={fmt} />
            </Widget>
          </WidgetGrid>

          {/* Mark as Paid modal */}
          {markPaidTransfer && (
            <MarkPaidDialog
              transfer={markPaidTransfer}
              amount={markPaidAmount}
              setAmount={setMarkPaidAmount}
              loading={markPaidLoading}
              onConfirm={handleMarkPaid}
              onClose={() => setMarkPaidTransfer(null)}
            />
          )}

        </>
      )}
    </Page>
  )
}
