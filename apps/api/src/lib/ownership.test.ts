import { describe, it, expect, vi } from 'vitest'

vi.mock('./prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))

import { ownershipTarget, partitionByOwnership } from './ownership'

const item = (ownership: string, monthly: number, extra: { ownedByUserId?: string | null; customSplits?: { userId: string; pct: number }[] } = {}) => ({
  ownership,
  monthlyEquivalent: monthly,
  ownedByUserId: extra.ownedByUserId ?? null,
  customSplits: extra.customSplits ?? [],
})

describe('ownershipTarget', () => {
  it('falls back to shared when an individual item has no owner or a custom item has no splits', () => {
    expect(ownershipTarget(item('INDIVIDUAL', 1, { ownedByUserId: 'u1' }))).toBe('individual')
    expect(ownershipTarget(item('INDIVIDUAL', 1))).toBe('shared')
    expect(ownershipTarget(item('CUSTOM', 1, { customSplits: [{ userId: 'u1', pct: 100 }] }))).toBe('custom')
    expect(ownershipTarget(item('CUSTOM', 1))).toBe('shared')
  })
})

describe('partitionByOwnership', () => {
  it('never drops an amount', () => {
    const items = [
      item('SHARED', 100),
      item('INDIVIDUAL', 50, { ownedByUserId: 'u1' }),
      item('INDIVIDUAL', 25), // owner removed
      item('CUSTOM', 40, { customSplits: [{ userId: 'u1', pct: 75 }, { userId: 'u2', pct: 25 }] }),
    ]
    const p = partitionByOwnership(items)
    expect(p.shared).toBe(125)
    expect(p.individual.get('u1')).toBe(50)
    expect(p.custom.get('u1')).toBe(30)
    expect(p.custom.get('u2')).toBe(10)
  })

  it('splits a resolved effective amount when given one', () => {
    const p = partitionByOwnership([{ ...item('SHARED', 100), effectiveAmount: 180 }], (i) => i.effectiveAmount)
    expect(p.shared).toBe(180)
  })
})
