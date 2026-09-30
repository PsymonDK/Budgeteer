// Central TanStack Query key factory. The arrays are the exact keys the app has
// always used, so prefix invalidation keeps working as before: e.g.
// qk.categories(id) also matches qk.categories(id, 'EXPENSE'), and
// qk.transfersAll() matches every transfers query including the breakdown.

import type { CategoryType } from './types'

type Id = string | null | undefined

export const qk = {
  // ── App / current user ──────────────────────────────────────────────────────
  config: () => ['config'] as const,
  currencies: () => ['currencies'] as const,
  /** GET /users/me */
  me: () => ['users-me'] as const,
  /** GET /users/me → preferences only */
  preferences: () => ['preferences'] as const,
  /** Prefix of the personal dashboard queries below. */
  meAll: () => ['me'] as const,
  meDashboard: () => ['me', 'dashboard'] as const,
  meSummary: () => ['me', 'summary'] as const,
  incomeSummaryMe: () => ['income-summary-me'] as const,
  incomeTrendMe: () => ['income-trend-me'] as const,
  incomeSankeyMe: () => ['income-sankey-me'] as const,
  users: () => ['users'] as const,
  /** GET /me/reminders — invalidate whenever a manual item or transfer is marked or dismissed */
  reminders: () => ['reminders'] as const,
  /** GET /me/notification-settings */
  myNotificationSettings: () => ['notification-settings', 'me'] as const,
  /** GET /households/:id/notification-settings */
  householdNotificationSettings: (householdId: Id) => ['notification-settings', 'household', householdId] as const,
  /** GET /admin/notification-settings */
  adminNotificationSettings: () => ['admin', 'notification-settings'] as const,
  /** GET /admin/notification-deliveries */
  adminNotificationDeliveries: () => ['admin', 'notification-deliveries'] as const,

  // ── Households ──────────────────────────────────────────────────────────────
  households: () => ['households'] as const,
  householdsAdmin: () => ['households', 'admin'] as const,
  household: (householdId: Id) => ['household', householdId] as const,
  householdTrash: (householdId: Id) => ['trash', 'household', householdId] as const,
  incomeTrash: (userId: Id) => ['trash', 'income', userId] as const,
  budgetYears: (householdId: Id) => ['budget-years', householdId] as const,
  categories: (householdId: Id, type?: CategoryType) =>
    (type ? ['categories', householdId, type] : ['categories', householdId]) as readonly unknown[],
  categoriesAdmin: () => ['categories', 'admin'] as const,
  dashboard: (householdId: Id) => ['dashboard', householdId] as const,
  dashboardForYear: (householdId: Id, budgetYearId: Id) => ['dashboard', householdId, budgetYearId] as const,
  savingsHistory: (householdId: Id) => ['savings-history', householdId] as const,
  trends: (householdId: Id) => ['trends', householdId] as const,
  compare: (householdId: Id, yearIdA: string, yearIdB: string) => ['compare', householdId, yearIdA, yearIdB] as const,
  incomeSummary: (householdId: Id) => ['income-summary', householdId] as const,

  // ── Receipts ────────────────────────────────────────────────────────────────
  /** GET /households/:id/receipts (one summary row per receipt) */
  receipts: (householdId: Id) => ['receipts', householdId] as const,
  /** GET /households/:id/receipts/:receiptId */
  receipt: (householdId: Id, receiptId: Id) => ['receipt', householdId, receiptId] as const,
  /** Prefix of every consumption summary of a household (all periods, receipts page and dashboard). */
  receiptSummaryAll: (householdId: Id) => ['receipt-summary', householdId] as const,
  receiptSummary: (householdId: Id, period: string, startDate: string, endDate: string) =>
    ['receipt-summary', householdId, period, startDate, endDate] as const,
  receiptSubcategories: (householdId: Id) => ['receipt-subcategories', householdId] as const,
  receiptMappingExportKit: (householdId: Id) => ['receipt-mapping-export-kit', householdId] as const,

  // ── Accounts ────────────────────────────────────────────────────────────────
  accountsPersonal: () => ['accounts', 'personal'] as const,
  accountsHousehold: (householdId: Id) => ['accounts', 'household', householdId] as const,
  accountsForBudgetYear: (budgetYearId: Id) => ['accounts-for-budget-year', budgetYearId] as const,

  // ── Budget-year data ────────────────────────────────────────────────────────
  expenses: (budgetYearId: Id) => ['expenses', budgetYearId] as const,
  savings: (budgetYearId: Id) => ['savings', budgetYearId] as const,
  /** Prefix of every transfers query (list and breakdown, all budget years). */
  transfersAll: () => ['transfers'] as const,
  transfers: (budgetYearId: Id) => ['transfers', budgetYearId] as const,
  transferBreakdown: (budgetYearId: Id) => ['transfers', 'breakdown', budgetYearId] as const,
  /** Prefix of every month's occurrences for a budget year. */
  occurrences: (budgetYearId: Id) => ['occurrences', budgetYearId] as const,
  occurrencesMonth: (budgetYearId: Id, month: number | 'current') => ['occurrences', budgetYearId, month] as const,
  /** GET /budget-years/:id/payments — under the occurrences prefix so marking items paid refreshes it */
  payments: (budgetYearId: Id, month: number | 'current') => ['occurrences', budgetYearId, 'payments', month] as const,

  // ── Personal income ─────────────────────────────────────────────────────────
  jobsAll: () => ['jobs'] as const,
  jobs: (userId: Id) => ['jobs', userId] as const,
  salary: (jobId: Id) => ['salary', jobId] as const,
  allOverridesAll: () => ['all-overrides'] as const,
  allOverrides: (jobIds: string) => ['all-overrides', jobIds] as const,
  allBonusesAll: () => ['all-bonuses'] as const,
  allBonuses: (jobIds: string) => ['all-bonuses', jobIds] as const,
  taxCardsAll: () => ['taxcards'] as const,
  taxCards: (jobIds: string) => ['taxcards', jobIds] as const,
  incomeHistoryAll: () => ['income-history'] as const,
  incomeHistory: (userId: Id, from: string, to: string, granularity: string) =>
    ['income-history', userId, from, to, granularity] as const,

  // ── System admin ────────────────────────────────────────────────────────────
  adminCurrencies: () => ['admin', 'currencies'] as const,
  adminAutomations: () => ['admin', 'automations'] as const,
  adminReceiptTraining: () => ['admin', 'receipt-training'] as const,
}
