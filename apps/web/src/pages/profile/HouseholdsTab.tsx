import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Home } from 'lucide-react'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useHouseholds } from '../../api/queries'
import type { UserIncomeSummary } from '../../api/types'
import { PageLoader } from '../../components/LoadingSpinner'
import { cardClass } from './cardClass'

// ── Tab 2: Households ────────────────────────────────────────────────────────

export function HouseholdsTab() {
  const { data: summary } = useQuery<UserIncomeSummary>({
    queryKey: qk.incomeSummaryMe(),
    queryFn: async () => (await api.get<UserIncomeSummary>('/users/me/income/summary')).data,
  })

  const { data: households = [], isLoading } = useHouseholds()

  return (
    <div className="space-y-6">
      {summary?.overAllocated && (
        <div className="flex items-center gap-3 bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            Your income is over-allocated
            {summary.overAllocatedJobs.length > 0 && (
              <> ({summary.overAllocatedJobs.map((j) => `${j.jobName} ${j.year}: ${Number(j.allocationPct)}%`).join(', ')})</>
            )}
            . Review your allocations on the{' '}
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
