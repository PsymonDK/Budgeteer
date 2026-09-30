import { describe, it, expect, vi } from 'vitest'

vi.mock('./prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))

import { totalExpensesOf, totalSavingsOf, userShareOfItems } from './userBudgetShare'

const item = (ownership: string, monthly: number, extra: { ownedByUserId?: string | null; customSplits?: { userId: string; pct: number }[] } = {}) => ({
  ownership,
  monthlyEquivalent: monthly,
  ownedByUserId: extra.ownedByUserId ?? null,
  customSplits: extra.customSplits ?? [],
})

describe('userShareOfItems', () => {
  // Two members; me earns 40% of the household's allocated gross
  const expenses = [
    item('SHARED', 1000),
    item('INDIVIDUAL', 200, { ownedByUserId: 'me' }),
    item('INDIVIDUAL', 500, { ownedByUserId: 'partner' }),
    item('CUSTOM', 300, { customSplits: [{ userId: 'me', pct: 50 }, { userId: 'partner', pct: 50 }] }),
  ]
  const savings = [
    item('CUSTOM', 2000, { customSplits: [{ userId: 'me', pct: 50 }, { userId: 'partner', pct: 50 }] }),
    item('INDIVIDUAL', 800, { ownedByUserId: 'partner' }),
  ]

  it('applies the income share to shared items only', () => {
    const share = userShareOfItems(expenses, savings, 'me', 0.4)
    expect(share.personalExpenses).toBe(200)
    expect(share.householdShareExpenses).toBeCloseTo(1000 * 0.4 + 150)
    expect(share.personalSavings).toBe(0)
    expect(share.householdShareSavings).toBe(1000)
  })

  it("never charges another member's personal items", () => {
    const share = userShareOfItems(expenses, savings, 'me', 0.4)
    // Pro-rating everything by income share would give 2000 × 0.4 = 800 and 2800 × 0.4 = 1120
    expect(totalExpensesOf(share)).toBeCloseTo(750)
    expect(totalSavingsOf(share)).toBe(1000)
  })

  it('the members\' shares add up to the household totals', () => {
    const me = userShareOfItems(expenses, savings, 'me', 0.4)
    const partner = userShareOfItems(expenses, savings, 'partner', 0.6)
    expect(totalExpensesOf(me) + totalExpensesOf(partner)).toBeCloseTo(2000)
    expect(totalSavingsOf(me) + totalSavingsOf(partner)).toBeCloseTo(2800)
  })
})
