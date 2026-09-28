import type { ReactNode } from 'react'
import type { AccountInfo } from '../api/types'
import { ACCOUNT_TYPE_LABELS } from '../lib/constants'
import { inputClass } from '../lib/styles'

interface AccountSelectProps {
  value: string
  onChange: (value: string) => void
  personal: AccountInfo[]
  household: AccountInfo[]
  /** Options listed before the account groups (e.g. "— None —"). */
  children?: ReactNode
}

/** Account picker with "My accounts" and "Household accounts" option groups. */
export function AccountSelect({ value, onChange, personal, household, children }: AccountSelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {children}
      {personal.length > 0 && (
        <optgroup label="My accounts">
          {personal.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
          ))}
        </optgroup>
      )}
      {household.length > 0 && (
        <optgroup label="Household accounts">
          {household.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_LABELS[a.type]})</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
