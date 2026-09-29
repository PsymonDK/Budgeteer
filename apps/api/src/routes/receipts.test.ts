import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('../lib/prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))
vi.mock('../plugins/authenticate', () => ({ authenticate: vi.fn() }))

import { isTotalMismatch } from './receipts'

const d = (v: string) => new Prisma.Decimal(v)

describe('isTotalMismatch', () => {
  it('flags line items that do not add up to the printed total', () => {
    expect(isTotalMismatch(d('37.95'), d('40.00'))).toBe(true)
  })

  it('tolerates a one-cent rounding difference', () => {
    expect(isTotalMismatch(d('37.95'), d('37.96'))).toBe(false)
    expect(isTotalMismatch(d('37.95'), d('37.95'))).toBe(false)
  })

  it('does not flag receipts without a printed total', () => {
    expect(isTotalMismatch(d('37.95'), null)).toBe(false)
  })
})
