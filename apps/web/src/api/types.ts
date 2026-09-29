// Shared shapes of API responses used by more than one screen.
// Each type mirrors the route that returns it (apps/api/src/routes/*); Prisma
// Decimals arrive as strings and DateTimes as ISO strings.

import type { AccountType } from '../lib/constants'

// ── Enums ─────────────────────────────────────────────────────────────────────

export type UserRole = 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER'
export type HouseholdRole = 'ADMIN' | 'MEMBER'
export type BudgetYearStatus = 'ACTIVE' | 'FUTURE' | 'RETIRED' | 'SIMULATION'
export type BudgetModel = 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'
export type CategoryType = 'EXPENSE' | 'SAVINGS'
/** Ownership of an expense or savings entry. */
export type Ownership = 'SHARED' | 'INDIVIDUAL' | 'CUSTOM'

// ── Households ────────────────────────────────────────────────────────────────

/** A membership row as included by GET /households and GET /households/:id. */
export interface HouseholdMember {
  id: string
  householdId: string
  userId: string
  role: HouseholdRole
  joinedAt: string
  user: {
    id: string
    name: string
    email: string
    isActive: boolean
    /** Not selected by the households routes today, so always undefined. */
    isProxy?: boolean
  }
}

/** GET /households (list) and GET /households/:id (detail) return the same shape. */
export interface Household {
  id: string
  name: string
  isActive: boolean
  autoMarkTransferPaid: boolean
  budgetModel: BudgetModel
  createdAt: string
  updatedAt: string
  myRole: HouseholdRole | null
  members: HouseholdMember[]
  _count: { members: number }
}

// ── Budget years ──────────────────────────────────────────────────────────────

/** GET /households/:id/budget-years */
export interface BudgetYear {
  id: string
  householdId: string
  year: number
  status: BudgetYearStatus
  simulationName: string | null
  copiedFromId: string | null
  createdAt: string
  updatedAt: string
  _count: { expenses: number; savingsEntries: number }
}

/** The compact budget-year reference embedded in summary responses. */
export interface BudgetYearRef {
  id: string
  year: number
  status: BudgetYearStatus
}

// ── Categories ────────────────────────────────────────────────────────────────

/** GET /categories */
export interface Category {
  id: string
  name: string
  icon: string | null
  categoryType: CategoryType
  isSystemWide: boolean
  isActive: boolean
  householdId: string | null
  createdAt: string
  createdBy: { id: string; name: string }
  _count: { expenses: number; savingsEntries: number }
}

// ── Currencies & config ───────────────────────────────────────────────────────

/** GET /currencies — `rate` is null until the first rate sync for that currency. */
export interface Currency {
  code: string
  name: string
  rate: number | null
  baseCurrency: string
  fetchedDate: string | null
}

/** GET /config */
export interface AppConfig {
  baseCurrency: string
}

// ── Current user ──────────────────────────────────────────────────────────────

export interface UserPreferences {
  preferredCurrency: string
  defaultHouseholdId: string | null
  notifyOverAllocation: boolean
  notifyExpensesExceedIncome: boolean
  notifyNoSavings: boolean
  notifyUncategorised: boolean
  showDashboardSparklines: boolean
}

/** GET /users/me */
export interface UserMe {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  isProxy: boolean
  avatarUrl: string | null
  mustChangePassword: boolean
  createdAt: string
  preferences: UserPreferences | null
}

// ── Income summaries ──────────────────────────────────────────────────────────

/** GET /users/me/income/summary */
export interface UserIncomeSummary {
  totalMonthly: string
  totalAllocated: string
  totalUnallocated: string
  allocationPct: string
  overAllocated: boolean
  budgetYear: { year: number; status: BudgetYearStatus } | null
  overAllocatedJobs: { jobId: string; jobName: string; year: number; allocationPct: string }[]
}

// ── Accounts ──────────────────────────────────────────────────────────────────

/** GET /users/me/accounts and GET /households/:id/accounts */
export interface Account {
  id: string
  name: string
  type: AccountType
  isActive: boolean
  ownedByUserId: string | null
  householdId: string | null
  createdAt: string
  updatedAt: string
  _count: { expenses: number; savingsEntries: number }
}

/** A compact account as embedded in expenses/savings and returned for form pickers. */
export interface AccountInfo {
  id: string
  name: string
  type: AccountType
}

/** GET /budget-years/:id/accounts — active accounts the caller may tag entries with. */
export interface AccountGroups {
  personal: (AccountInfo & { isActive: boolean })[]
  household: (AccountInfo & { isActive: boolean })[]
}

/** Create/edit form for a personal or household account. */
export interface AccountForm {
  name: string
  type: AccountType
}

// ── Expense / savings ownership ───────────────────────────────────────────────

/** One member's share in a custom-split form (pct kept as the input string). */
export interface CustomSplitInput {
  userId: string
  pct: string
}

// ── Receipts ──────────────────────────────────────────────────────────────────

export type ReceiptSummaryPeriod =
  | 'allTime' | 'currentMonth' | 'previousMonth' | 'currentQuarter' | 'previousQuarter'
  | 'currentYear' | 'previousYear' | 'last12Months' | 'custom'

/** GET /households/:id/receipts/summary — confirmed, non-ignored receipt lines in base currency. */
export interface ReceiptConsumptionSummary {
  total: string
  itemCount: number
  baseCurrency: string
  /** 'legacy' when the request used the old year/month parameters. */
  period: ReceiptSummaryPeriod | 'legacy'
  startDate: string | null
  endDate: string | null
  warnings: string[]
  byCategory: Array<{ categoryId: string | null; categoryName: string; categoryIcon: string | null; total: string; itemCount: number }>
  bySubcategory: Array<{ categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: string; itemCount: number }>
  byMonth: Array<{ month: string; total: string }>
}
