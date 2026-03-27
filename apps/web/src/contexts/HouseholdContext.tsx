import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from './AuthContext'

const LS_KEY = 'budgeteer_active_household'

interface Household { id: string; name: string }

interface HouseholdCtx {
  activeHouseholdId: string | null
  setActiveHousehold: (id: string) => void
}

const HouseholdContext = createContext<HouseholdCtx>({ activeHouseholdId: null, setActiveHousehold: () => {} })

export function useHousehold() { return useContext(HouseholdContext) }

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(
    () => localStorage.getItem(LS_KEY)
  )

  const { data: households } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
    enabled: !!user,
    retry: false,
  })

  // Validate stored ID on load; fall back if no longer member
  useEffect(() => {
    if (!households) return
    const stored = localStorage.getItem(LS_KEY)
    if (stored && households.some((h) => h.id === stored)) {
      setActiveHouseholdId(stored)
    } else if (households.length > 0) {
      const fallback = households[0].id
      setActiveHouseholdId(fallback)
      localStorage.setItem(LS_KEY, fallback)
    }
  }, [households])

  // Pure state update — navigation is the caller's responsibility
  const setActiveHousehold = useCallback((id: string) => {
    localStorage.setItem(LS_KEY, id)
    setActiveHouseholdId(id)
  }, [])

  return (
    <HouseholdContext.Provider value={{ activeHouseholdId, setActiveHousehold }}>
      {children}
    </HouseholdContext.Provider>
  )
}
