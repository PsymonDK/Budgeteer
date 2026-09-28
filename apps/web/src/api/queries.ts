// Shared TanStack Query hooks for server state read by several screens.
// Each hook owns the key (see queryKeys.ts) and the request, so every screen
// reading the same data shares one cache entry.

import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { qk } from './queryKeys'
import type {
  AccountGroups, AppConfig, BudgetYear, Category, CategoryType, Currency, Household, UserMe, UserPreferences,
} from './types'

/** Per-call options a screen may set on a shared query. */
interface QueryOpts {
  enabled?: boolean
  retry?: boolean
}

/** GET /config — static server config, fetched once per session. */
export function useConfig() {
  return useQuery({
    queryKey: qk.config(),
    queryFn: async () => (await api.get<AppConfig>('/config')).data,
    staleTime: Infinity,
  })
}

/** GET /currencies — enabled currencies with their latest rate. */
export function useCurrencies() {
  return useQuery({
    queryKey: qk.currencies(),
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })
}

/** GET /households — the caller's active households (all active ones for a system admin). */
export function useHouseholds(opts: QueryOpts = {}) {
  return useQuery({
    queryKey: qk.households(),
    queryFn: async () => (await api.get<Household[]>('/households')).data,
    ...opts,
  })
}

/**
 * GET /households/:id. Named `useHouseholdDetail` because `useHousehold` is the
 * active-household context hook (contexts/HouseholdContext.tsx).
 */
export function useHouseholdDetail(householdId: string | undefined) {
  return useQuery({
    queryKey: qk.household(householdId),
    queryFn: async () => (await api.get<Household>(`/households/${householdId}`)).data,
    enabled: !!householdId,
  })
}

/** GET /households/:id/budget-years — all years including simulations, newest first. */
export function useBudgetYears(householdId: string | undefined) {
  return useQuery({
    queryKey: qk.budgetYears(householdId),
    queryFn: async () => (await api.get<BudgetYear[]>(`/households/${householdId}/budget-years`)).data,
    enabled: !!householdId,
  })
}

/** GET /categories — system-wide plus the household's custom categories, optionally of one type. */
export function useCategories(householdId: string | undefined, type?: CategoryType) {
  return useQuery({
    queryKey: qk.categories(householdId, type),
    queryFn: async () =>
      (await api.get<Category[]>(
        type ? `/categories?householdId=${householdId}&type=${type}` : `/categories?householdId=${householdId}`,
      )).data,
    enabled: !!householdId,
  })
}

/** GET /budget-years/:id/accounts — accounts for the expense/savings account picker. */
export function useBudgetYearAccounts(budgetYearId: string | undefined) {
  return useQuery({
    queryKey: qk.accountsForBudgetYear(budgetYearId),
    queryFn: async () => (await api.get<AccountGroups>(`/budget-years/${budgetYearId}/accounts`)).data,
    enabled: !!budgetYearId,
  })
}

/** GET /users/me — the signed-in user with preferences. */
export function useUserMe(opts: QueryOpts = {}) {
  return useQuery({
    queryKey: qk.me(),
    queryFn: async () => (await api.get<UserMe>('/users/me')).data,
    ...opts,
  })
}

/** The signed-in user's preferences, cached separately from useUserMe under qk.preferences(). */
export function usePreferences(opts: QueryOpts = {}) {
  return useQuery({
    queryKey: qk.preferences(),
    queryFn: async () => (await api.get<UserMe>('/users/me')).data.preferences as UserPreferences | null,
    ...opts,
  })
}
