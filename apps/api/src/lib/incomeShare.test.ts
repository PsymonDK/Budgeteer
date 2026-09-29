import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { computeIncomeShares, formatSharePct, splitByShares } from './incomeShare'

const d = (v: string | number) => new Decimal(v)

describe('computeIncomeShares', () => {
  it('splits proportionally to allocated gross income', () => {
    const shares = computeIncomeShares(['a', 'b'], new Map([['a', d(30000)], ['b', d(10000)]]))
    expect(shares.get('a')!.toNumber()).toBe(0.75)
    expect(shares.get('b')!.toNumber()).toBe(0.25)
  })

  it('keeps shares unrounded for three equal earners (they sum to exactly 1)', () => {
    const shares = computeIncomeShares(['a', 'b', 'c'], new Map([['a', d(100)], ['b', d(100)], ['c', d(100)]]))
    const sum = [...shares.values()].reduce((s, v) => s.plus(v), d(0))
    expect(sum.toDecimalPlaces(20).toNumber()).toBe(1)
    expect(formatSharePct(shares.get('a'))).toBe('33.3')
  })

  it('falls back to an equal split when no income is allocated', () => {
    const shares = computeIncomeShares(['a', 'b', 'c'], new Map())
    for (const id of ['a', 'b', 'c']) expect(formatSharePct(shares.get(id))).toBe('33.3')
    expect(computeIncomeShares(['a', 'b'], new Map([['a', d(0)], ['b', d(0)]])).get('b')!.toNumber()).toBe(0.5)
  })

  it('gives a member without income a zero share when others have income', () => {
    const shares = computeIncomeShares(['a', 'b'], new Map([['a', d(5000)]]))
    expect(shares.get('a')!.toNumber()).toBe(1)
    expect(shares.get('b')!.toNumber()).toBe(0)
  })

  it('ignores income of users who are not in the member list', () => {
    const shares = computeIncomeShares(['a', 'b'], new Map([['a', d(100)], ['b', d(100)], ['left', d(200)]]))
    expect(shares.get('a')!.toNumber()).toBe(0.5)
    expect(shares.has('left')).toBe(false)
  })

  it('returns no shares for a household without members', () => {
    expect(computeIncomeShares([], new Map([['a', d(1)]])).size).toBe(0)
  })
})

describe('splitByShares', () => {
  const equalThree = computeIncomeShares(['a', 'b', 'c'], new Map())

  it('splits 100 three ways into cents that add up to 100.00', () => {
    const parts = splitByShares(100, equalThree)
    expect([...parts.values()].map((v) => v.toFixed(2))).toEqual(['33.34', '33.33', '33.33'])
    expect([...parts.values()].reduce((s, v) => s.plus(v), d(0)).toFixed(2)).toBe('100.00')
  })

  it('does not lose money that a 33.3% rounded share would (99.90)', () => {
    const parts = splitByShares(d('9000.00'), equalThree)
    expect([...parts.values()].reduce((s, v) => s.plus(v), d(0)).toFixed(2)).toBe('9000.00')
  })

  it('splits proportionally and rounds the total to cents', () => {
    const shares = computeIncomeShares(['a', 'b'], new Map([['a', d(3)], ['b', d(1)]]))
    const parts = splitByShares(1000.005, shares)
    expect(parts.get('a')!.toFixed(2)).toBe('750.01')
    expect(parts.get('b')!.toFixed(2)).toBe('250.00')
  })

  it('returns zeros for a zero total', () => {
    const parts = splitByShares(0, equalThree)
    expect([...parts.values()].every((v) => v.isZero())).toBe(true)
  })
})
