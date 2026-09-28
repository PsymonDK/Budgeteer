import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { getApiError } from '../lib/apiError'

interface OccurrenceItem {
  id: string
  kind: 'expense' | 'savings'
  entryId: string
  label: string
  categoryName: string | null
  status: 'PENDING' | 'PAID' | 'SKIPPED'
  scheduledAmount: string
  carriedAmount: string
  dueAmount: string
  actualAmount: string | null
  paidAt: string | null
}

interface MonthItems {
  budgetModel: 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'
  year: number
  month: number
  isReadOnly: boolean
  items: OccurrenceItem[]
  totals: { due: string; paid: string; unpaid: string }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Pay/No-pay item checklist for one month. Each expense and savings item is marked
 * paid on its own (or all at once); whatever is still unpaid when the month closes
 * carries into the next month. Renders nothing for other budget models.
 */
export function MonthItemsPanel({ budgetYearId, fmt }: { budgetYearId: string; fmt: (v: number | string) => string }) {
  const queryClient = useQueryClient()
  // undefined = let the API pick the current month of the budget year
  const [month, setMonth] = useState<number | undefined>(undefined)

  const queryKey = ['occurrences', budgetYearId, month ?? 'current']
  const { data, isLoading } = useQuery<MonthItems>({
    queryKey,
    queryFn: async () =>
      (await api.get<MonthItems>(`/budget-years/${budgetYearId}/occurrences`, { params: month ? { month } : undefined })).data,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['occurrences', budgetYearId] })
    // The month's transfer total and breakdown can change
    queryClient.invalidateQueries({ queryKey: ['transfers'] })
  }

  const toggleMutation = useMutation({
    mutationFn: (item: OccurrenceItem) =>
      api.patch(`/budget-years/${budgetYearId}/occurrences/${item.kind}/${item.id}`, {
        status: item.status === 'PAID' ? 'PENDING' : 'PAID',
      }),
    onSuccess: refresh,
    onError: (err) => toast.error(getApiError(err, 'Failed to update item')),
  })

  const markAllMutation = useMutation({
    mutationFn: (m: number) => api.post(`/budget-years/${budgetYearId}/occurrences/mark-all-paid`, { month: m }),
    onSuccess: () => { refresh(); toast.success('All items marked as paid') },
    onError: (err) => toast.error(getApiError(err, 'Failed to mark items as paid')),
  })

  if (isLoading || !data || data.budgetModel !== 'PAY_NO_PAY') return null

  const shownMonth = data.month
  const pendingCount = data.items.filter((i) => i.status === 'PENDING').length
  const busy = toggleMutation.isPending || markAllMutation.isPending

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-amber-400" />
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Items this month</h2>
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

      {data.items.length === 0 ? (
        <p className="text-gray-500 text-sm">No items scheduled for this month.</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-800">
            {data.items.map((item) => {
              const closed = item.status === 'SKIPPED'
              const carried = Number(item.carriedAmount) > 0
              return (
                <li key={`${item.kind}:${item.id}`} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={item.status === 'PAID'}
                    disabled={closed || data.isReadOnly || busy}
                    onChange={() => toggleMutation.mutate(item)}
                    className="accent-amber-400 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Mark ${item.label} as ${item.status === 'PAID' ? 'unpaid' : 'paid'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${item.status === 'PAID' ? 'text-gray-500 line-through' : 'text-white'}`}>
                      {item.label}
                      {item.kind === 'savings' && <span className="ml-2 text-xs text-blue-400 no-underline">savings</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.categoryName ?? 'Uncategorised'}
                      {carried && <> · includes {fmt(item.carriedAmount)} carried over</>}
                      {closed && <> · month closed, carried to next month</>}
                    </p>
                  </div>
                  <span className={`text-sm tabular-nums ${closed ? 'text-gray-600' : 'text-gray-200'}`}>{fmt(item.dueAmount)}</span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-800 flex-wrap">
            <p className="text-xs text-gray-400">
              Paid {fmt(data.totals.paid)} of {fmt(data.totals.due)}
              {Number(data.totals.unpaid) > 0 && (
                <span className="text-amber-400"> · {fmt(data.totals.unpaid)} unpaid carries to next month</span>
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
        </>
      )}
    </div>
  )
}
