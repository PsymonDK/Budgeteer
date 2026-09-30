import type { BudgetYearRef, Category } from '../../api/types'

// GET /households/:id/summary

export interface IncomeMember {
  userId: string
  name: string
  email: string
  monthlyAllocated: string
  monthlyAllocatedGross: string
  monthlyAllocatedNet: string
  sharePct: string
}

export interface ExpenseItem {
  id: string
  label: string
  amount: string
  frequency: string
  frequencyPeriod: string | null
  monthlyEquivalent: string
  notes: string | null
  category: Pick<Category, 'id' | 'name' | 'icon'>
}

export interface ExpenseByCategory {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  totalMonthly: string
}

export interface ExpenseByAccount {
  accountId: string
  accountName: string
  accountType: string
  totalMonthly: string
}

export interface MemberSplit {
  userId: string
  name: string
  sharePct: string
  monthlyIncomeAllocated: string
  monthlySharedOwed: string
  monthlyIndividualOwed: string
  monthlyCustomOwed: string
  monthlyTotalOwed: string
}

export interface Warnings {
  expensesExceedIncome: boolean
  noSavings: boolean
  uncategorisedExpenses: boolean
  unnamedSimulations: boolean
}

export interface DashboardSummary {
  budgetYear: BudgetYearRef | null
  income: { totalMonthly: string; members: IncomeMember[] }
  expenses: { totalMonthly: string; items: ExpenseItem[]; byCategory: ExpenseByCategory[]; byAccount: ExpenseByAccount[] }
  savings: { totalMonthly: string }
  surplus: string
  /** Savings as % of net income, one decimal; null without income */
  savingsRate: string | null
  /** Expenses, savings and surplus as % of net income, one decimal; null without income */
  incomeSplit: { expensesPct: string; savingsPct: string; surplusPct: string } | null
  incomeFlow: IncomeFlow | null
  memberSplits: MemberSplit[]
  warnings: Warnings
}

export type IncomeFlowTarget =
  | { kind: 'category'; categoryId: string; categoryName: string }
  | { kind: 'savings' }
  | { kind: 'surplus' }

/** Per-member split of each destination, in cents that add up (server-computed) */
export interface IncomeFlow {
  members: { userId: string; name: string }[]
  links: { userId: string; target: IncomeFlowTarget; amount: string }[]
}

// Receipt consumption types live in api/types.ts (shared with the receipts screens)

// GET /households/:id/savings-history

export interface SavingsHistoryRow {
  year: number
  status: string
  totalMonthlyIncome: string
  totalMonthlySavings: string
  savingsRate: string | null
}
