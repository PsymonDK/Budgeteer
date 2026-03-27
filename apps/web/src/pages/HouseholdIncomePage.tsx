import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { FREQ_LABELS, type Frequency } from '../lib/constants'
import { useFmt } from '../hooks/useFmt'

interface IncomeEntry {
  id: string
  label: string
  frequency: Frequency
  monthlyEquivalent: string
  allocationPct: number
  monthlyAllocated: string
}

interface MemberSummary {
  userId: string
  name: string
  email: string
  role: 'ADMIN' | 'MEMBER'
  monthlyAllocated: string
  monthlyAllocatedGross: string
  sharePct: string
  entries: IncomeEntry[]
}

interface IncomeSummary {
  budgetYear: { id: string; year: number; status: string } | null
  members: MemberSummary[]
  totalMonthly: string
}


export function HouseholdIncomePage() {
  const { id: householdId } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const fmt = useFmt()

  const { data: summary, isLoading } = useQuery<IncomeSummary>({
    queryKey: ['income-summary', householdId],
    queryFn: async () => (await api.get<IncomeSummary>(`/households/${householdId}/income-summary`)).data,
    enabled: !!householdId,
  })

  const totalMonthly = parseFloat(summary?.totalMonthly ?? '0')

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {summary?.budgetYear && (
        <div className="mb-6">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            summary.budgetYear.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' : 'bg-blue-900/50 text-blue-300'
          }`}>
            {summary.budgetYear.year} · {summary.budgetYear.status}
          </span>
        </div>
      )}

      <PageHeader
        title="Household Income"
        subtitle="Income allocated to this household, used to calculate each member's share of expenses."
      />

      {isLoading ? (
        <PageLoader />
      ) : !summary?.budgetYear ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-2">No active budget year for this household.</p>
          <p className="text-sm">
            <Link to={`/households/${householdId}/expenses`} className="text-amber-400 hover:text-amber-300">
              Go to Expenses →
            </Link>
          </p>
        </div>
      ) : summary.members.length === 0 || totalMonthly === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-2">No income has been allocated to this household yet.</p>
          <p className="text-sm">
            <Link to="/income" className="text-amber-400 hover:text-amber-300">Manage your income →</Link>
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Total / month</p>
              <p className="text-2xl font-bold text-amber-400">{fmt(totalMonthly)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Members contributing</p>
              <p className="text-2xl font-bold text-white">
                {summary.members.filter((m) => parseFloat(m.monthlyAllocated) > 0).length}
                <span className="text-gray-500 text-base font-normal"> / {summary.members.length}</span>
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Annual equivalent</p>
              <p className="text-2xl font-bold text-white">{fmt(totalMonthly * 12)}</p>
            </div>
          </div>

          {/* Per-member breakdown */}
          <div className="space-y-4">
            {summary.members.map((member) => {
              const monthly = parseFloat(member.monthlyAllocated)
              const share = parseFloat(member.sharePct)
              return (
                <div key={member.userId} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="text-white font-medium">{member.name}</span>
                        {member.userId === me?.id && <span className="text-gray-500 text-xs ml-2">(you)</span>}
                        <p className="text-gray-500 text-xs">{member.email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold text-lg">
                        {fmt(member.monthlyAllocatedGross ?? monthly)}
                        <span className="text-gray-500 text-sm font-normal"> gross / mo</span>
                      </p>
                      <p className="text-gray-400 text-sm">{share}% of household</p>
                      {member.monthlyAllocatedGross && parseFloat(member.monthlyAllocatedGross) !== monthly && (
                        <p className="text-gray-500 text-xs">{fmt(monthly)} net / mo</p>
                      )}
                    </div>
                  </div>

                  {/* Share bar */}
                  <div className="w-full bg-gray-800 rounded-full h-1.5 mb-3">
                    <div
                      className="bg-amber-400 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(share, 100)}%` }}
                    />
                  </div>

                  {/* Income entries breakdown */}
                  {member.entries.length > 0 && (
                    <div className="space-y-1">
                      {member.entries.map((e) => (
                        <div key={e.id} className="flex items-center justify-between text-sm">
                          <span className="text-gray-400">
                            {e.label}
                            <span className="text-gray-600 ml-1">· {FREQ_LABELS[e.frequency]} · {e.allocationPct}%</span>
                          </span>
                          <span className="text-gray-300 tabular-nums">{fmt(e.monthlyAllocated)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {monthly === 0 && (
                    <p className="text-gray-600 text-xs">
                      No income allocated to this household.{' '}
                      {member.userId === me?.id && (
                        <Link to="/income" className="text-amber-400 hover:text-amber-300">Add income →</Link>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </main>
  )
}
