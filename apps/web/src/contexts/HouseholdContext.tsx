import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { ACTIVE_HOUSEHOLD_KEY as LS_KEY } from '../lib/storageKeys'
import { useHouseholds } from '../api/queries'

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

  const { data: households } = useHouseholds({ enabled: !!user, retry: false })

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
    } else {
      // No memberships (left or removed from every household): forget the stale ID
      setActiveHouseholdId(null)
      localStorage.removeItem(LS_KEY)
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
