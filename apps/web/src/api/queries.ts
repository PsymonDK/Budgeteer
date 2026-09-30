// Shared TanStack Query hooks for server state read by several screens.
// Each hook owns the key (see queryKeys.ts) and the request, so every screen
// reading the same data shares one cache entry.

import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { qk } from './queryKeys'
import type {
  Account, AccountGroups, AppConfig, BudgetYear, Category, CategoryType, Currency, Household,
  MonthPayments, PaymentReminders, ReceiptConsumptionSummary, ReceiptSummaryPeriod, UserMe, UserPreferences,
} from './types'

/** Per-call options a screen may set on a shared query. */
interface QueryOpts {
  enabled?: boolean
  retry?: boolean
}

/** GET /config — server config that never changes at runtime, fetched once per session. */
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

/** GET /users/me/accounts — all of the caller's personal accounts, active and inactive. */
export function usePersonalAccounts() {
  return useQuery({
    queryKey: qk.accountsPersonal(),
    queryFn: async () => (await api.get<Account[]>('/users/me/accounts')).data,
  })
}

/** GET /households/:id/accounts — all of the household's accounts, active and inactive. */
export function useHouseholdAccounts(householdId: string | undefined) {
  return useQuery({
    queryKey: qk.accountsHousehold(householdId),
    queryFn: async () => (await api.get<Account[]>(`/households/${householdId}/accounts`)).data,
    enabled: !!householdId,
  })
}

/**
 * GET /households/:id/receipts/summary — confirmed receipt consumption for a period.
 * `startDate`/`endDate` are only sent for the custom period but always part of the key.
 */
export function useReceiptSummary(
  householdId: string | undefined,
  period: ReceiptSummaryPeriod,
  startDate: string,
  endDate: string,
  opts: QueryOpts = {},
) {
  return useQuery({
    queryKey: qk.receiptSummary(householdId, period, startDate, endDate),
    queryFn: async () => {
      const params = new URLSearchParams({ period })
      if (period === 'custom') {
        params.set('startDate', startDate)
        params.set('endDate', endDate)
      }
      return (await api.get<ReceiptConsumptionSummary>(`/households/${householdId}/receipts/summary?${params}`)).data
    },
    ...opts,
    enabled: !!householdId && (opts.enabled ?? true),
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

/** GET /budget-years/:id/payments — a month's payments with their due day (defaults to the current month). */
export function useMonthPayments(budgetYearId: string | undefined, month?: number) {
  return useQuery({
    queryKey: qk.payments(budgetYearId, month ?? 'current'),
    queryFn: async () =>
      (await api.get<MonthPayments>(`/budget-years/${budgetYearId}/payments`, { params: month ? { month } : undefined })).data,
    enabled: !!budgetYearId,
  })
}

/** GET /me/reminders — the signed-in member's manual payments due soon, due today or overdue. */
export function useReminders() {
  return useQuery({
    queryKey: qk.reminders(),
    queryFn: async () => (await api.get<PaymentReminders>('/me/reminders')).data,
    // Stages move with the calendar; refresh now and then as well as on focus
    refetchInterval: 15 * 60 * 1000,
  })
}
