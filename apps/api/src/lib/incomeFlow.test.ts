import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { buildIncomeFlow } from './incomeFlow'

const d = (v: number | string) => new Decimal(v)

describe('buildIncomeFlow', () => {
  it('splits each destination by net income share, in cents that add up', () => {
    const flow = buildIncomeFlow(
      [{ userId: 'a', name: 'A', net: d(2000) }, { userId: 'b', name: 'B', net: d(1000) }, { userId: 'c', name: 'C', net: d(0) }],
      [{ categoryId: 'rent', categoryName: 'Rent', total: d(100) }],
      d(30),
      d(0),
    )!
    expect(flow.members.map((m) => m.userId)).toEqual(['a', 'b'])
    const rent = flow.links.filter((l) => l.target.kind === 'category')
    expect(rent.map((l) => [l.userId, l.amount])).toEqual([['a', '66.67'], ['b', '33.33']])
    expect(flow.links.filter((l) => l.target.kind === 'savings').map((l) => l.amount)).toEqual(['20.00', '10.00'])
    expect(flow.links.some((l) => l.target.kind === 'surplus')).toBe(false)
  })

  it('returns null without income', () => {
    expect(buildIncomeFlow([{ userId: 'a', name: 'A', net: d(0) }], [], d(0), d(0))).toBeNull()
  })
})
