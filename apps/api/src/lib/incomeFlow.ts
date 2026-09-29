import { Decimal } from '@prisma/client/runtime/client'
import { splitByShares } from './incomeShare'

export type IncomeFlowTarget =
  | { kind: 'category'; categoryId: string; categoryName: string }
  | { kind: 'savings' }
  | { kind: 'surplus' }

export interface IncomeFlow {
  members: { userId: string; name: string }[]
  links: { userId: string; target: IncomeFlowTarget; amount: string }[]
}

/**
 * Where each member's net income goes each month — expense categories, savings and
 * surplus — for the dashboard's income-flow (Sankey) diagram. Every destination is
 * split by the members' share of household net income, in cents that add up to the
 * destination's total. Null when there's no income to show.
 */
export function buildIncomeFlow(
  members: { userId: string; name: string; net: Decimal }[],
  categories: { categoryId: string; categoryName: string; total: Decimal }[],
  savings: Decimal,
  surplus: Decimal,
): IncomeFlow | null {
  const earning = members.filter((m) => m.net.gt(0))
  const totalNet = earning.reduce((s, m) => s.plus(m.net), new Decimal(0))
  if (earning.length === 0 || totalNet.lte(0)) return null

  const shares = new Map(earning.map((m) => [m.userId, m.net.div(totalNet)]))
  const links: IncomeFlow['links'] = []
  const add = (total: Decimal, target: IncomeFlowTarget) => {
    if (total.lte(0)) return
    for (const [userId, amount] of splitByShares(total, shares)) {
      if (amount.gt(0)) links.push({ userId, target, amount: amount.toFixed(2) })
    }
  }

  for (const c of categories) add(c.total, { kind: 'category', categoryId: c.categoryId, categoryName: c.categoryName })
  add(savings, { kind: 'savings' })
  add(surplus, { kind: 'surplus' })

  return { members: earning.map((m) => ({ userId: m.userId, name: m.name })), links }
}
