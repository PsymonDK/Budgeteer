import type { CustomSplitInput, HouseholdMember, Ownership } from '../api/types'
import { inputClass } from '../lib/styles'

export interface OwnershipValue {
  ownership: Ownership
  ownedByUserId: string | null
  customSplits: CustomSplitInput[]
}

interface OwnershipFieldsProps {
  members: Pick<HouseholdMember, 'userId' | 'user'>[]
  value: OwnershipValue
  onChange: (next: OwnershipValue) => void
}

/** Sum of the entered custom-split percentages (live form feedback only). */
export function customSplitTotal(splits: CustomSplitInput[]): number {
  return splits.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
}

/**
 * Shared / individual / custom-split ownership inputs for expense and savings
 * forms. Renders nothing when the household has no members.
 */
export function OwnershipFields({ members, value, onChange }: OwnershipFieldsProps) {
  if (members.length === 0) return null
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Ownership</label>
        <select
          value={value.ownership}
          onChange={(e) => onChange({ ownership: e.target.value as Ownership, ownedByUserId: null, customSplits: [] })}
          className={inputClass}
        >
          <option value="SHARED">Shared (split by income %)</option>
          <option value="INDIVIDUAL">Individual (one member)</option>
          <option value="CUSTOM">Custom split</option>
        </select>
      </div>
      {value.ownership === 'INDIVIDUAL' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Assigned to</label>
          <select
            value={value.ownedByUserId ?? ''}
            onChange={(e) => onChange({ ...value, ownedByUserId: e.target.value || null })}
            required
            className={inputClass}
          >
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.user.name}</option>
            ))}
          </select>
        </div>
      )}
      {value.ownership === 'CUSTOM' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">Custom split %</label>
          <div className="space-y-2">
            {members.map((m) => {
              const split = value.customSplits.find((s) => s.userId === m.userId)
              return (
                <div key={m.userId} className="flex items-center gap-3">
                  <span className="text-sm text-gray-300 flex-1">{m.user.name}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={split?.pct ?? ''}
                    onChange={(ev) => {
                      const next = value.customSplits.filter((s) => s.userId !== m.userId)
                      if (ev.target.value) next.push({ userId: m.userId, pct: ev.target.value })
                      onChange({ ...value, customSplits: next })
                    }}
                    placeholder="0"
                    className={inputClass + ' w-24 text-right'}
                  />
                  <span className="text-xs text-gray-500 w-4">%</span>
                </div>
              )
            })}
            {(() => {
              const total = customSplitTotal(value.customSplits)
              return (
                <p className={`text-xs text-right ${Math.abs(total - 100) < 0.01 ? 'text-green-400' : 'text-amber-400'}`}>
                  Total: {total.toFixed(1)}%{Math.abs(total - 100) < 0.01 ? '' : ' (must equal 100%)'}
                </p>
              )
            })()}
          </div>
        </div>
      )}
    </>
  )
}
