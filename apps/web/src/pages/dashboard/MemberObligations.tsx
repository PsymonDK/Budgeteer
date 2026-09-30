import type { MemberBreakdown } from '../../hooks/useTransferBreakdown'
import type { MemberSplit } from './types'

interface MemberObligationsProps {
  memberSplits: MemberSplit[]
  meId: string | undefined
  memberBreakdownMap: Map<string, MemberBreakdown>
  fmt: (v: number | string) => string
}

/** HH-005: what each member transfers per month, split by account. */
export function MemberObligations({ memberSplits, meId, memberBreakdownMap, fmt }: MemberObligationsProps) {
  return (
    <div className="flex flex-col">
      <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">Monthly obligations</h2>
      <div className={`grid gap-4 ${memberSplits.length === 1 ? 'grid-cols-1' : 'grid-cols-1 @xl:grid-cols-2'}`}>
        {memberSplits.map((m) => {
          const isMe = m.userId === meId
          const memberBd = memberBreakdownMap.get(m.userId)
          return (
            <div
              key={m.userId}
              className={`rounded-xl p-5 border ${isMe ? 'bg-amber-950/30 border-amber-700/50' : 'bg-gray-900 border-gray-800'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isMe ? 'text-amber-300' : 'text-white'}`}>{m.name}</span>
                  {isMe && <span className="text-xs bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded-full">you</span>}
                </div>
                <span className="text-xs text-gray-500">{m.sharePct}% of gross income</span>
              </div>
              {memberBd && memberBd.byAccount.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {memberBd.byAccount.map((a) => (
                    <div key={a.accountId ?? '__untagged__'} className="flex justify-between text-sm">
                      <span className="text-gray-400">{a.accountName}</span>
                      <span className="text-gray-300 tabular-nums">{fmt(a.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mb-4" />
              )}
              <div className={`flex justify-between items-baseline border-t pt-3 ${isMe ? 'border-amber-800/40' : 'border-gray-800'}`}>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Amount to transfer / mo</span>
                <span className={`font-display text-2xl tabular-nums ${isMe ? 'text-amber-400' : 'text-gray-100'}`}>
                  {fmt(memberBd?.monthlyTotal ?? parseFloat(m.monthlyTotalOwed))}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
