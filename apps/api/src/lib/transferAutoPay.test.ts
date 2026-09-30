import { describe, expect, it } from 'vitest'
import { planTransferAutoPay } from './transferAutoPay'

const t = (month: number, status = 'PENDING', year = 2026) => ({ id: `${year}-${month}`, year, month, status })

describe('planTransferAutoPay', () => {
  const sept = (day: number) => new Date(2026, 8, day) // September 2026

  it('marks the current month once its due day has come', () => {
    expect(planTransferAutoPay([t(9)], 25, sept(24))).toEqual([])
    expect(planTransferAutoPay([t(9)], 25, sept(25))).toEqual(['2026-9'])
  })

  it('catches up on earlier months still pending, and leaves future months alone', () => {
    expect(planTransferAutoPay([t(7), t(8), t(10)], 1, sept(1))).toEqual(['2026-7', '2026-8'])
  })

  it('treats a due day past the month end as its last day', () => {
    expect(planTransferAutoPay([t(9)], 31, sept(30))).toEqual(['2026-9'])
    expect(planTransferAutoPay([t(2)], 30, new Date(2026, 1, 28))).toEqual(['2026-2'])
  })

  it('skips transfers already paid or adjusted', () => {
    expect(planTransferAutoPay([t(8, 'PAID'), t(8, 'ADJUSTED')], 1, sept(15))).toEqual([])
  })

  it('handles a past budget year as fully due', () => {
    expect(planTransferAutoPay([t(12, 'PENDING', 2025)], 28, new Date(2026, 0, 2))).toEqual(['2025-12'])
  })
})
