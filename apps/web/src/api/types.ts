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

/** How an expense or savings entry is paid; MANUAL ones are listed to tick off in Pay/No-pay households */
export type PaymentMethod = 'AUTOMATIC' | 'MANUAL'

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
  /** How the monthly transfer into the budget account is made; AUTOMATIC is marked paid on its due day */
  transferPaymentMethod: PaymentMethod
  /** Day of the month the transfer is due (1–31) */
  transferDueDay: number
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

/**
 * A month's paid state for an expense or savings item. SKIPPED: closed at a Pay/No-pay month
 * end with the balance carried over. DISMISSED: taken off the to-pay list by a member.
 */
export type OccurrenceStatus = 'PENDING' | 'PAID' | 'SKIPPED' | 'DISMISSED'
export type DismissReason = 'PAID_ELSEWHERE' | 'SKIPPED'

/** One expense or savings payment in a month (GET /budget-years/:id/payments). */
export interface MonthPayment {
  kind: 'expense' | 'savings'
  entryId: string
  label: string
  categoryName: string | null
  /** Day of the month, already clamped to the month's length; null = no set day */
  day: number | null
  /** Set for entries paid several times a month; they have no single day */
  recurrence: 'WEEKLY' | 'FORTNIGHTLY' | null
  paymentMethod: PaymentMethod
  /** Amount due this month, base currency */
  amount: string
  /**
   * Paid status from the month's occurrence: manual items in every budget model, automatic
   * ones too in Pay/No-pay. Null when the item has no occurrence.
   */
  status: OccurrenceStatus | null
  /** Why it was taken off the to-pay list, when DISMISSED */
  dismissReason: DismissReason | null
}

/** GET /budget-years/:id/payments */
export interface MonthPayments {
  budgetModel: 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'
  year: number
  month: number
  /** Sorted by day, items without a day last */
  items: MonthPayment[]
  /** Closed (SKIPPED) items are left out; doneCount (paid or dismissed) and unpaid count manual items */
  totals: { count: number; due: string; manualCount: number; doneCount: number; unpaid: string }
}

export type ReminderStage = 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE'

/** A manual payment that needs attention now (GET /me/reminders). */
export interface PaymentReminder {
  /** "expense:<occurrence id>", "savings:<occurrence id>" or "transfer:<transfer id>" */
  key: string
  kind: 'expense' | 'savings' | 'transfer'
  label: string
  amount: string
  /** YYYY-MM-DD */
  dueDate: string
  stage: ReminderStage
  /** Negative when overdue */
  daysUntilDue: number
  /** Days before the due date "due soon" starts, for this member in this household */
  leadDays: number
  householdId: string
  householdName: string
  budgetYearId: string
}

/** GET /me/reminders — due soon (within each reminder's leadDays), due today and overdue, overdue first */
export interface PaymentReminders {
  date: string
  reminders: PaymentReminder[]
  counts: { overdue: number; dueToday: number; dueSoon: number; total: number }
}

// ── Notification settings (admin → household → member; each narrows the one above) ──

/** Which channels the level above allows */
export interface AllowedChannels { inApp: boolean; email: boolean; webhook: boolean }

/** GET/PUT /admin/notification-settings */
export interface SystemNotificationSettings {
  inAppEnabled: boolean
  emailEnabled: boolean
  webhookEnabled: boolean
  /** Let webhooks reach private and loopback addresses (e.g. an ntfy server on the LAN) */
  webhookAllowPrivateNetwork: boolean
}

/** GET /admin/notification-deliveries */
export interface NotificationDeliveryRow {
  id: string
  channel: 'EMAIL' | 'WEBHOOK'
  date: string
  status: 'SENT' | 'FAILED'
  attempts: number
  error: string | null
  updatedAt: string
  reminderCount: number
  user: { name: string; email: string } | null
  household: { name: string } | null
}

export interface HouseholdNotificationSettings {
  inAppEnabled: boolean
  emailEnabled: boolean
  webhookEnabled: boolean
  /** Shared ntfy topic or webhook URL */
  webhookUrl: string | null
  leadDays: number
}

/** GET/PUT /households/:id/notification-settings */
export interface HouseholdNotificationResponse {
  settings: HouseholdNotificationSettings
  allowed: AllowedChannels
}

export interface UserReminderSettings {
  reminderInApp: boolean
  reminderEmail: boolean
  reminderEmailAddress: string | null
  reminderWebhook: boolean
  reminderWebhookUrl: string | null
  /** null = each household's default */
  reminderLeadDays: number | null
  /** HH:MM */
  reminderDigestTime: string
}

/** GET /me/notification-settings (saved through PUT /users/me/preferences) */
export interface MyNotificationSettings {
  settings: UserReminderSettings
  loginEmail: string
  allowed: AllowedChannels
}
