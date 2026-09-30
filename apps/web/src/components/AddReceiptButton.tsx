import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { useHouseholds, useUserMe } from '../api/queries'

/**
 * The household a new receipt goes to: `householdId`, or — outside a household — the
 * user's default household (falling back to their first one). Null while none is known.
 */
export function useReceiptTargetHousehold(householdId?: string | null) {
  const { data: households = [] } = useHouseholds({ enabled: !householdId })
  const { data: me } = useUserMe({ enabled: !householdId })

  return useMemo(() => {
    if (householdId) return householdId
    const defaultId = me?.preferences?.defaultHouseholdId
    if (defaultId && households.some((household) => household.id === defaultId)) return defaultId
    return households[0]?.id ?? null
  }, [householdId, households, me?.preferences?.defaultHouseholdId])
}

/** Opens the add-receipt page of the target household (see `useReceiptTargetHousehold`). */
export function AddReceiptButton({ householdId }: { householdId?: string | null }) {
  const navigate = useNavigate()
  const targetHouseholdId = useReceiptTargetHousehold(householdId)

  return (
    <button
      type="button"
      disabled={!targetHouseholdId}
      onClick={() => {
        if (targetHouseholdId) navigate(`/households/${targetHouseholdId}/receipts/new`)
      }}
      className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-gray-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
    >
      <ScanLine size={16} />
      <span className="hidden sm:inline">Add receipt</span>
    </button>
  )
}
