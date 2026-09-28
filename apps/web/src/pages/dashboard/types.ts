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
  memberSplits: MemberSplit[]
  warnings: Warnings
}

// GET /households/:id/receipts/summary

export type ReceiptSummaryPeriod = 'currentMonth' | 'previousMonth' | 'currentYear' | 'custom'

export interface ReceiptConsumptionSummary {
  total: string
  itemCount: number
  baseCurrency: string
  period: ReceiptSummaryPeriod | 'allTime' | 'legacy'
  startDate: string | null
  endDate: string | null
  warnings: string[]
  byCategory: Array<{ categoryId: string | null; categoryName: string; categoryIcon: string | null; total: string; itemCount: number }>
  bySubcategory: Array<{ categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: string; itemCount: number }>
}

// GET /households/:id/savings-history

export interface SavingsHistoryRow {
  year: number
  status: string
  totalMonthlyIncome: string
  totalMonthlySavings: string
  savingsRate: string | null
}
