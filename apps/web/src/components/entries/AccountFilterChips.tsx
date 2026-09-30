import type { Dispatch, SetStateAction } from 'react'
import type { AccountInfo } from '../../api/types'
import { ACCOUNT_TYPE_LABELS } from '../../lib/constants'

/** The distinct accounts tagged on a list of entries, sorted by name. */
export function accountsIn(entries: { account: AccountInfo | null }[]): AccountInfo[] {
  const map = new Map<string, AccountInfo>()
  for (const e of entries) {
    if (e.account) map.set(e.account.id, e.account)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

interface AccountFilterChipsProps {
  accounts: AccountInfo[]
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  /** Extra classes on the chip row (e.g. spacing). */
  className?: string
}

/** Toggleable account chips filtering the expenses / savings lists. Renders nothing without accounts. */
export function AccountFilterChips({ accounts, selected, setSelected, className }: AccountFilterChipsProps) {
  if (accounts.length === 0) return null
  return (
    <div className={className ? `flex items-center gap-2 flex-wrap ${className}` : 'flex items-center gap-2 flex-wrap'}>
      <span className="text-xs text-gray-500 mr-1">Account:</span>
      {accounts.map((a) => (
        <button
          key={a.id}
          onClick={() => setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(a.id)) next.delete(a.id); else next.add(a.id)
            return next
          })}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            selected.has(a.id)
              ? 'bg-gray-200 border-gray-200 text-gray-950 font-medium'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          {a.name}
          <span className="ml-1 opacity-60">{ACCOUNT_TYPE_LABELS[a.type]}</span>
        </button>
      ))}
      {selected.size > 0 && (
        <button onClick={() => setSelected(new Set())} className="text-xs text-gray-600 hover:text-gray-400 transition-colors ml-1">
          Clear
        </button>
      )}
    </div>
  )
}
