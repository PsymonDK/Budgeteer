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
import { ExpenseBreakdown } from './ExpenseBreakdown'
import { MarkPaidDialog, TransferByAccount, TransferHistory, TransferTile } from './Transfers'
import type { DashboardSummary, SavingsHistoryRow } from './types'
import type { ReceiptSummaryPeriod } from '../../api/types'

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
    <main className="max-w-7xl mx-auto px-6 py-8">

      {/* Budget year badge */}
      {summary?.budgetYear && (
        <div className="mb-5">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            summary.budgetYear.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' : 'bg-blue-900/50 text-blue-300'
          }`}>
            {summary.budgetYear.year} · {summary.budgetYear.status}
          </span>
        </div>
      )}

      <h1 className="text-2xl font-semibold mb-1">{household?.name ?? '…'}</h1>
      <p className="text-gray-400 text-sm mb-6">Dashboard</p>

      {/* DASH-003: Warning banners */}
      {visibleWarnings.length > 0 && (
        <div className="space-y-2 mb-6">
          {visibleWarnings.map((w) => (
            <div
              key={w.key}
              className="flex items-center justify-between bg-amber-950/60 border border-amber-700/50 text-amber-300 px-4 py-3 rounded-lg text-sm"
            >
              <span>⚠ {w.message}</span>
              <button
                onClick={() => dismiss(w.key)}
                className="ml-4 text-amber-500 hover:text-amber-300 text-lg leading-none"
              >
                ×
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
          {/* DASH-001: Summary cards */}
          <SummaryCards
            income={income}
            expenses={expenses}
            savings={savings}
            surplus={surplus}
            savingsRate={savingsRate}
            baseCurrency={baseCurrency}
          />

          {/* VIZ-001: Income flow diagram */}
          {sankeyData && sankeyData.links.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Income flow</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <SankeyChart data={sankeyData} currency={baseCurrency} />
              </div>
            </div>
          )}

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

          {/* HH-005: Member expense splits */}
          {summary.memberSplits.length > 0 && (
            <MemberObligations
              memberSplits={summary.memberSplits}
              meId={me?.id}
              memberBreakdownMap={memberBreakdownMap}
              fmt={fmt}
            />
          )}

          {/* SAV-003: Affordability calculator */}
          {surplus > 0 && (
            <AffordabilityCalculator
              extraSavings={extraSavings}
              setExtraSavings={setExtraSavings}
              sliderMax={sliderMax}
              adjustedSurplus={adjustedSurplus}
              savings={savings}
              income={income}
              fmt={fmt}
            />
          )}

          {/* SAV-002: Savings rate history */}
          <SavingsRateHistory savingsHistory={savingsHistory} />

          <ExpenseBreakdown
            summary={summary}
            expenses={expenses}
            expenseView={expenseView}
            setExpenseView={setExpenseView}
            householdId={householdId}
            fmt={fmt}
          />

          {/* Budget transfer tile */}
          <TransferTile nextPending={nextPending} onMarkPaid={openMarkPaid} fmt={fmt} />

          {/* Pay/No-pay: per-item paid checklist for the month */}
          {summary?.budgetYear?.id && <MonthItemsPanel budgetYearId={summary.budgetYear.id} fmt={fmt} />}

          {/* Transfer history */}
          <TransferHistory
            transfers={transfers}
            collapsed={historyCollapsed}
            onToggleCollapsed={() => setHistoryCollapsed((c) => !c)}
            onMarkPaid={openMarkPaid}
            onRevert={handleRevert}
            fmt={fmt}
          />

          {/* Transfer breakdown by account */}
          <TransferByAccount breakdown={transferBreakdown} fmt={fmt} />

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
    </main>
  )
}
