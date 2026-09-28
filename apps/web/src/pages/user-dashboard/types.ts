// Response shapes for the personal dashboard (GET /users/me/dashboard, /me/summary, /users/me/income/*).

export interface PersonalDashboard {
  income: {
    grossMonthly: string
    netMonthly: string
    allocatedAmount: string
    allocatedPct: string
    unallocatedAmount: string
    sparkline: { month: string; gross: number; net: number }[]
  }
  expenses: {
    personal: { monthlyEquivalent: string; sparkline: { label: string; amount: number }[] }
    householdShare: { monthlyEquivalent: string; sparkline: { label: string; amount: number }[] }
    total: { monthlyEquivalent: string }
  }
  savings: {
    monthlyEquivalent: string
    pctOfGross: string
    pctOfNet: string
    sparkline: { label: string; amount: number }[]
  }
  surplus: { amount: string; isPositive: boolean }
}

export interface HouseholdSummary {
  id: string
  name: string
  myRole: 'ADMIN' | 'MEMBER'
  memberCount: number
  monthlyGrossIncome: string
  monthlyIncome: string
  monthlyExpenses: string
  monthlySavings: string
  monthlySurplus: string
  budgetYear: { id: string; year: number; status: string } | null
  warnings: { expensesExceedIncome: boolean; noSavings: boolean }
  previousYear: {
    year: number
    monthlyGrossIncome: string
    monthlyIncome: string
    monthlyExpenses: string
    monthlySavings: string
    monthlySurplus: string
  } | null
}

export interface UserSummary {
  totals: { monthlyGrossIncome: string; monthlyIncome: string; monthlyExpenses: string; monthlySavings: string; monthlySurplus: string }
  previousTotals: { monthlyGrossIncome: string } | null
  householdCount: number
  households: HouseholdSummary[]
}

export interface NewHousehold { id: string; name: string }

export interface IncomeTrend {
  months: string[]
  jobs: { id: string; name: string; monthly: number[]; monthlyNet: number[] }[]
  total: number[]
  totalNet: number[]
  bonuses: { jobId: string; month: string; amount: number; amountNet: number; label: string }[]
}

export interface IncomeSankeyData {
  totalIncome: string
  employerPensionMonthly?: string
  nodes: { id: string; name: string; color?: string }[]
  links: { source: string; target: string; value: number }[]
}
