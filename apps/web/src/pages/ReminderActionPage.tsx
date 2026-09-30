import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { Check, TriangleAlert } from 'lucide-react'
import { api } from '../api/client'
import { BrandMark } from '../components/BrandMark'
import { useFmt } from '../hooks/useFmt'
import { primaryBtn } from '../lib/styles'

interface ActionInfo {
  state: 'VALID' | 'DONE' | 'USED' | 'EXPIRED' | 'INVALID'
  item: { kind: 'expense' | 'savings' | 'transfer'; label: string; amount: string; month: number; year: number; householdName: string } | null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A "Mark as paid" link from a reminder email. Works without logging in. Opening it only
 * shows what it's for; the button marks it paid (once). Email scanners that open links
 * therefore change nothing.
 */
export function ReminderActionPage() {
  const { token = '' } = useParams<{ token: string }>()
  const fmt = useFmt()
  const { data, isLoading } = useQuery({
    queryKey: ['reminder-action', token],
    queryFn: async () => (await api.get<ActionInfo>(`/reminder-actions/${token}`)).data,
    retry: false,
    staleTime: Infinity,
  })
  const markMutation = useMutation({
    mutationFn: () => api.post<{ outcome: 'MARKED' | 'ALREADY_DONE' }>(`/reminder-actions/${token}`),
  })

  const markError = axios.isAxiosError(markMutation.error) ? (markMutation.error.response?.data as { error?: string } | undefined)?.error : undefined
  const item = data?.item

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6"><BrandMark /></div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4" aria-live="polite">
          {isLoading || !data ? (
            <p className="text-sm text-gray-400">Checking the link…</p>
          ) : markMutation.isSuccess ? (
            <Outcome icon="ok" title={markMutation.data.data.outcome === 'MARKED' ? 'Marked as paid' : 'Already paid'}>
              {item && <>{item.label} for {MONTHS[item.month - 1]} is ticked off in {item.householdName}.</>}
            </Outcome>
          ) : data.state === 'VALID' && item ? (
            <>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-gray-400">{item.householdName}</p>
                <h1 className="font-display text-2xl text-gray-100 mt-1">Mark {item.label} as paid?</h1>
              </div>
              <p className="text-sm text-gray-400">
                <span className="text-gray-100 font-semibold tabular-nums">{fmt(item.amount)}</span> for {MONTHS[item.month - 1]} {item.year}.
                {' '}This link works once.
              </p>
              {markError && <p className="text-sm text-red-300" role="alert">{markError}</p>}
              <button type="button" onClick={() => markMutation.mutate()} disabled={markMutation.isPending} className={`w-full inline-flex items-center justify-center gap-2 ${primaryBtn}`}>
                <Check size={16} aria-hidden="true" /> {markMutation.isPending ? 'Marking…' : 'Mark as paid'}
              </button>
            </>
          ) : data.state === 'DONE' ? (
            <Outcome icon="ok" title="Already paid">{item && <>{item.label} for {MONTHS[item.month - 1]} is already ticked off.</>}</Outcome>
          ) : (
            <Outcome icon="warn" title={data.state === 'USED' ? 'This link has been used' : data.state === 'EXPIRED' ? 'This link has expired' : "This link isn't valid"}>
              {data.state === 'INVALID'
                ? 'It may have been copied incompletely.'
                : 'Mark-as-paid links work once, for 14 days.'}
              {' '}You can tick the payment off in Budgeteer instead.
            </Outcome>
          )}
          <p className="text-xs text-gray-500 pt-2 border-t border-gray-800">
            <Link to="/" className="text-amber-400 hover:text-amber-300">Open Budgeteer</Link>
          </p>
        </div>
      </div>
    </main>
  )
}

function Outcome({ icon, title, children }: { icon: 'ok' | 'warn'; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      {icon === 'ok'
        ? <Check size={20} className="shrink-0 mt-1 text-green-400" aria-hidden="true" />
        : <TriangleAlert size={20} className="shrink-0 mt-1 text-orange-400" aria-hidden="true" />}
      <div>
        <h1 className="font-display text-xl text-gray-100">{title}</h1>
        <p className="text-sm text-gray-400 mt-1">{children}</p>
      </div>
    </div>
  )
}
