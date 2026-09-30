import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, ChevronLeft, ChevronRight, ListChecks, MoreHorizontal, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { qk } from '../api/queryKeys'
import { useReminders } from '../api/queries'
import type { DismissReason, OccurrenceStatus, PaymentMethod } from '../api/types'
import { getApiError } from '../lib/apiError'

interface OccurrenceItem {
  id: string
  kind: 'expense' | 'savings'
  entryId: string
  label: string
  categoryName: string | null
  /** The month it's due in; earlier than the shown month for overdue items */
  month: number
  status: OccurrenceStatus
  dismissReason: DismissReason | null
  scheduledAmount: string
  carriedAmount: string
  dueAmount: string
  actualAmount: string | null
  paidAt: string | null
}

/** The household's monthly transfer into the budget account, when it's paid by hand */
interface TransferItem {
  id: string
  month: number
  amount: string
  status: 'PENDING' | 'PAID' | 'ADJUSTED'
  actualAmount: string | null
  dueDay: number
}

interface MonthItems {
  budgetModel: 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'
  year: number
  month: number
  isReadOnly: boolean
  /** Pay/No-pay carries unpaid items into the next month; the other models keep them as overdue */
  carriesOver: boolean
  transferPaymentMethod: PaymentMethod
  /** Manual transfer: this month's, plus unpaid earlier ones (empty when the transfer is automatic) */
  transfers: TransferItem[]
  items: OccurrenceItem[]
  /** Unpaid items from earlier months, listed with the current month */
  overdue: OccurrenceItem[]
  totals: { due: string; paid: string; unpaid: string }
  /** Pay/No-pay: automatically paid items this month; not listed, they're marked paid when the month closes */
  automaticCount: number
  /** Manually paid entries in the budget year */
  manualEntryCount: number
}

type Change = { status: 'PAID' | 'PENDING' } | { status: 'DISMISSED'; reason: DismissReason }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DISMISS_LABEL: Record<DismissReason, string> = { PAID_ELSEWHERE: 'Paid elsewhere', SKIPPED: 'Skipped this month' }

/**
 * The to-pay list: what the household pays by hand this month, in every budget model.
 * Each item is ticked off on its own (or all at once), or dismissed as paid elsewhere or
 * skipped. In Pay/No-pay whatever is unpaid when the month closes carries into the next
 * month; in the other models it stays on the list as overdue. A manually made household
 * transfer is listed first. Renders nothing when nothing is paid by hand.
 */
export function MonthItemsPanel({ budgetYearId, fmt }: { budgetYearId: string; fmt: (v: number | string) => string }) {
  const queryClient = useQueryClient()
  // undefined = let the API pick the current month of the budget year
  const [month, setMonth] = useState<number | undefined>(undefined)

  const { data, isLoading } = useQuery<MonthItems>({
    queryKey: qk.occurrencesMonth(budgetYearId, month ?? 'current'),
    queryFn: async () =>
      (await api.get<MonthItems>(`/budget-years/${budgetYearId}/occurrences`, { params: month ? { month } : undefined })).data,
  })

  // What needs attention now, for the summary under the title
  const { data: reminderData } = useReminders()
  const reminders = reminderData?.reminders.filter((r) => r.budgetYearId === budgetYearId) ?? []

  function refresh() {
    queryClient.invalidateQueries({ queryKey: qk.occurrences(budgetYearId) })
    queryClient.invalidateQueries({ queryKey: qk.reminders() })
    // The month's transfer total and breakdown can change
    queryClient.invalidateQueries({ queryKey: qk.transfersAll() })
  }

  const changeMutation = useMutation({
    mutationFn: ({ item, change }: { item: OccurrenceItem; change: Change }) =>
      api.patch(`/budget-years/${budgetYearId}/occurrences/${item.kind}/${item.id}`, change),
    onSuccess: refresh,
    onError: (err) => toast.error(getApiError(err, 'Failed to update item')),
  })

  const transferMutation = useMutation({
    mutationFn: ({ transfer, paid }: { transfer: TransferItem; paid: boolean }) =>
      paid
        ? api.patch(`/budget-years/${budgetYearId}/transfers/${transfer.id}/mark-paid`, { actualAmount: parseFloat(transfer.amount) })
        : api.patch(`/budget-years/${budgetYearId}/transfers/${transfer.id}/mark-pending`),
    onSuccess: refresh,
    onError: (err) => toast.error(getApiError(err, 'Failed to update the transfer')),
  })

  const markAllMutation = useMutation({
    mutationFn: (m: number) => api.post(`/budget-years/${budgetYearId}/occurrences/mark-all-paid`, { month: m }),
    onSuccess: () => { refresh(); toast.success('All items marked as paid') },
    onError: (err) => toast.error(getApiError(err, 'Failed to mark items as paid')),
  })

  if (isLoading || !data) return null
  // Nothing is paid by hand: no list and no Mark-as-paid controls
  if (data.manualEntryCount === 0 && data.overdue.length === 0 && data.transfers.length === 0) return null

  const shownMonth = data.month
  const pendingCount = [...data.items, ...data.overdue, ...data.transfers].filter((i) => i.status === 'PENDING').length
  const busy = changeMutation.isPending || markAllMutation.isPending || transferMutation.isPending
  const onChange = (item: OccurrenceItem, change: Change) => changeMutation.mutate({ item, change })
  const rowProps = { fmt, busy, readOnly: data.isReadOnly, onChange }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-amber-400" aria-hidden="true" />
          <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest">To pay by hand</h2>
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-300">
          <button
            onClick={() => setMonth(Math.max(1, shownMonth - 1))}
            disabled={shownMonth <= 1}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="w-32 text-center tabular-nums">{MONTH_NAMES[shownMonth - 1]} {data.year}</span>
          <button
            onClick={() => setMonth(Math.min(12, shownMonth + 1))}
            disabled={shownMonth >= 12}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {reminders.length > 0 && <ReminderSummary reminders={reminders} leadDays={reminderData?.leadDays ?? 2} />}

      {data.transfers.length > 0 && (
        <ul className="divide-y divide-gray-800 mb-4 pb-3 border-b border-gray-800">
          {data.transfers.map((t) => (
            <TransferRow
              key={t.id}
              transfer={t}
              overdue={t.month < shownMonth}
              fmt={fmt}
              locked={data.isReadOnly || busy}
              onToggle={(paid) => transferMutation.mutate({ transfer: t, paid })}
            />
          ))}
        </ul>
      )}

      {data.overdue.length > 0 && (
        <section aria-labelledby="overdue-heading" className="mb-4">
          <h3 id="overdue-heading" className="flex items-center gap-1.5 text-xs font-semibold text-red-300 mb-1">
            <TriangleAlert size={13} aria-hidden="true" /> Overdue from earlier months
          </h3>
          <ul className="divide-y divide-gray-800">
            {data.overdue.map((item) => <ItemRow key={`${item.kind}:${item.id}`} item={item} overdue {...rowProps} />)}
          </ul>
        </section>
      )}

      {data.items.length === 0 ? (
        <p className="text-gray-500 text-sm">Nothing to pay by hand in {MONTH_NAMES[shownMonth - 1]}.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {data.items.map((item) => <ItemRow key={`${item.kind}:${item.id}`} item={item} {...rowProps} />)}
        </ul>
      )}

      {(data.items.length > 0 || pendingCount > 0) && (
        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-800 flex-wrap">
          <p className="text-xs text-gray-400">
            {data.items.length > 0 && <>Paid {fmt(data.totals.paid)} of {fmt(data.totals.due)}</>}
            {Number(data.totals.unpaid) > 0 && (
              <span className="text-amber-400">
                {' '}· {fmt(data.totals.unpaid)} {data.carriesOver ? 'unpaid carries to next month' : 'still to pay'}
              </span>
            )}
          </p>
          {!data.isReadOnly && pendingCount > 0 && (
            <button
              onClick={() => markAllMutation.mutate(shownMonth)}
              disabled={busy}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {markAllMutation.isPending ? 'Marking…' : `Mark all paid (${pendingCount})`}
            </button>
          )}
        </div>
      )}

      {data.automaticCount > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {data.automaticCount} automatic {data.automaticCount === 1 ? 'payment is' : 'payments are'} marked paid when the month closes.
        </p>
      )}
    </div>
  )
}

/** What needs attention now: overdue, due today and due within the lead time. */
function ReminderSummary({ reminders, leadDays }: { reminders: { stage: string }[]; leadDays: number }) {
  const count = (stage: string) => reminders.filter((r) => r.stage === stage).length
  const parts = [
    { n: count('OVERDUE'), text: 'overdue', className: 'text-red-300' },
    { n: count('DUE_TODAY'), text: 'due today', className: 'text-amber-300' },
    { n: count('DUE_SOON'), text: `due in the next ${leadDays} days`, className: 'text-gray-300' },
  ].filter((p) => p.n > 0)
  return (
    <p className="-mt-2 mb-4 text-sm" role="status">
      {parts.map((p, i) => (
        <span key={p.text}>
          {i > 0 && <span className="text-gray-600"> · </span>}
          <b className={`font-semibold ${p.className}`}>{p.n}</b> <span className="text-gray-400">{p.text}</span>
        </span>
      ))}
    </p>
  )
}

function TransferRow({ transfer, overdue, fmt, locked, onToggle }: {
  transfer: TransferItem
  overdue: boolean
  fmt: (v: number | string) => string
  locked: boolean
  onToggle: (paid: boolean) => void
}) {
  const paid = transfer.status !== 'PENDING'
  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={paid}
        disabled={locked}
        onChange={() => onToggle(!paid)}
        className="accent-amber-400 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        aria-label={`Mark the ${MONTH_NAMES[transfer.month - 1]} transfer as ${paid ? 'not made' : 'made'}`}
      />
      <div className="flex-1 min-w-0">
        <p className={`flex items-center gap-1.5 text-sm truncate ${paid ? 'text-gray-500 line-through' : 'text-white'}`}>
          <ArrowRightLeft size={13} className="shrink-0 text-amber-400" aria-hidden="true" />
          Transfer to the budget account
        </p>
        <p className="text-xs text-gray-500">
          <span className={overdue && !paid ? 'text-red-300' : undefined}>Due {transfer.dueDay} {MONTH_SHORT[transfer.month - 1]}</span>
          {transfer.status === 'ADJUSTED' && transfer.actualAmount && <> · {fmt(transfer.actualAmount)} transferred</>}
        </p>
      </div>
      <span className={`text-sm tabular-nums ${paid ? 'text-gray-600' : 'text-gray-200'}`}>{fmt(transfer.amount)}</span>
      <span className="w-6" aria-hidden="true" />
    </li>
  )
}

function ItemRow({ item, overdue = false, fmt, busy, readOnly, onChange }: {
  item: OccurrenceItem
  overdue?: boolean
  fmt: (v: number | string) => string
  busy: boolean
  readOnly: boolean
  onChange: (item: OccurrenceItem, change: Change) => void
}) {
  const [showActions, setShowActions] = useState(false)
  const closed = item.status === 'SKIPPED'
  const dismissed = item.status === 'DISMISSED'
  const paid = item.status === 'PAID'
  const carried = Number(item.carriedAmount) > 0
  const locked = closed || readOnly || busy
  const actionsId = `actions-${item.kind}-${item.id}`

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={paid}
          disabled={locked || dismissed}
          onChange={() => onChange(item, { status: paid ? 'PENDING' : 'PAID' })}
          className="accent-amber-400 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Mark ${item.label} as ${paid ? 'unpaid' : 'paid'}`}
        />
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${paid || dismissed ? 'text-gray-500 line-through' : 'text-white'}`}>
            {item.label}
            {item.kind === 'savings' && <span className="ml-2 text-xs text-blue-400 no-underline">savings</span>}
          </p>
          <p className="text-xs text-gray-500">
            {overdue && <span className="text-red-300">Due {MONTH_SHORT[item.month - 1]} · </span>}
            {item.categoryName ?? 'Uncategorised'}
            {carried && <> · includes {fmt(item.carriedAmount)} carried over</>}
            {closed && <> · month closed, carried to next month</>}
            {dismissed && item.dismissReason && <> · {DISMISS_LABEL[item.dismissReason]}</>}
          </p>
        </div>
        <span className={`text-sm tabular-nums ${closed || dismissed ? 'text-gray-600' : 'text-gray-200'}`}>{fmt(item.dueAmount)}</span>
        {dismissed ? (
          <button
            type="button"
            onClick={() => onChange(item, { status: 'PENDING' })}
            disabled={locked}
            className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 px-1"
          >
            Undo
          </button>
        ) : item.status === 'PENDING' && !readOnly ? (
          <button
            type="button"
            onClick={() => setShowActions((v) => !v)}
            aria-expanded={showActions}
            aria-controls={actionsId}
            aria-label={`More for ${item.label}`}
            className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-6" aria-hidden="true" />
        )}
      </div>
      {showActions && item.status === 'PENDING' && (
        <div id={actionsId} className="flex flex-wrap gap-2 mt-2 pl-7">
          {(['PAID_ELSEWHERE', 'SKIPPED'] as const).map((reason) => (
            <button
              key={reason}
              type="button"
              disabled={locked}
              onClick={() => { onChange(item, { status: 'DISMISSED', reason }); setShowActions(false) }}
              className="text-xs border border-gray-700 hover:border-gray-600 hover:bg-gray-800/60 text-gray-200 rounded-md px-2.5 py-1 disabled:opacity-50"
            >
              {DISMISS_LABEL[reason]}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
