import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ScanLine } from 'lucide-react'
import { api } from '../api/client'

interface Household {
  id: string
  name: string
}

interface UserMe {
  preferences: { defaultHouseholdId: string | null } | null
}

export function AddReceiptButton({ householdId }: { householdId?: string | null }) {
  const navigate = useNavigate()

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
    enabled: !householdId,
  })

  const { data: me } = useQuery<UserMe>({
    queryKey: ['users-me'],
    queryFn: async () => (await api.get<UserMe>('/users/me')).data,
    enabled: !householdId,
  })

  const targetHouseholdId = useMemo(() => {
    if (householdId) return householdId
    const defaultId = me?.preferences?.defaultHouseholdId
    if (defaultId && households.some((household) => household.id === defaultId)) return defaultId
    return households[0]?.id ?? null
  }, [householdId, households, me?.preferences?.defaultHouseholdId])

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
