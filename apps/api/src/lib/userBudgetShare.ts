import { BudgetStatus } from '@prisma/client'
import { prisma } from './prisma'
import { calcIncomeForYear, getIncomeReferenceDate } from './incomeCalc'
import { partitionByOwnership } from './ownership'
import { pickDefaultBudgetYear } from './budgetYearSelection'

/**
 * The part of one budget year's expenses and savings a user carries: their own
 * INDIVIDUAL items and custom splits in full ("personal"), plus their income
 * share of the shared pool ("household share"). Monthly amounts in base currency.
 *
 * Used by every personal view of the budget (dashboard cards, income flow), so
 * they always agree.
 */
export interface UserBudgetShare {
  personalExpenses: number
  householdShareExpenses: number
  personalSavings: number
  householdShareSavings: number
}

type ShareItem = Parameters<typeof partitionByOwnership>[0][number]

/**
 * Pure part of loadUserBudgetShare. `sharePct` (0–1) applies to SHARED items
 * only; another member's INDIVIDUAL items are never part of the user's share.
 */
export function userShareOfItems(
  expenses: ShareItem[],
  savings: ShareItem[],
  userId: string,
  sharePct: number,
): UserBudgetShare {
  const exp = partitionByOwnership(expenses)
  const sav = partitionByOwnership(savings)
  return {
    personalExpenses: exp.individual.get(userId) ?? 0,
    householdShareExpenses: exp.shared * sharePct + (exp.custom.get(userId) ?? 0),
    personalSavings: sav.individual.get(userId) ?? 0,
    householdShareSavings: sav.shared * sharePct + (sav.custom.get(userId) ?? 0),
  }
}

export function totalExpensesOf(s: UserBudgetShare): number {
  return s.personalExpenses + s.householdShareExpenses
}

export function totalSavingsOf(s: UserBudgetShare): number {
  return s.personalSavings + s.householdShareSavings
}

/**
 * The user's share of a budget year. The income share is the user's allocated
 * gross over the household's, at the year's income reference date (bonuses as a
 * yearly average) — the same basis the household dashboard splits on.
 */
export async function loadUserBudgetShare(
  budgetYear: { id: string; year: number; status: BudgetStatus },
  userId: string,
): Promise<UserBudgetShare> {
  const [expenses, savings, income] = await Promise.all([
    prisma.expense.findMany({ where: { budgetYearId: budgetYear.id }, include: { customSplits: true } }),
    prisma.savingsEntry.findMany({ where: { budgetYearId: budgetYear.id }, include: { customSplits: true } }),
    calcIncomeForYear(budgetYear.id, getIncomeReferenceDate(budgetYear.year, budgetYear.status)),
  ])
  const userGross = income.members.find((m) => m.userId === userId)?.monthlyAllocatedGross ?? 0
  const sharePct = income.totalMonthlyGross > 0 ? userGross / income.totalMonthlyGross : 0
  return userShareOfItems(expenses, savings, userId, sharePct)
}

/**
 * The user's share of each of their households' default budget year (earliest
 * ACTIVE, else earliest FUTURE). `householdIds` lists every household the user
 * belongs to; those without such a year have no entry in `shares`.
 */
export async function loadUserBudgetSharesByHousehold(userId: string) {
  const memberships = await prisma.householdMember.findMany({
    where: { userId },
    include: {
      household: {
        include: {
          budgetYears: {
            where: { status: { in: ['ACTIVE', 'FUTURE'] } },
            orderBy: { year: 'asc' },
          },
        },
      },
    },
  })

  const shares = await Promise.all(
    memberships.map(async (m) => {
      const budgetYear = pickDefaultBudgetYear(m.household.budgetYears)
      if (!budgetYear) return null
      return { householdId: m.householdId, budgetYear, share: await loadUserBudgetShare(budgetYear, userId) }
    }),
  )
  return { householdIds: memberships.map((m) => m.householdId), shares: shares.filter((s) => s !== null) }
}
