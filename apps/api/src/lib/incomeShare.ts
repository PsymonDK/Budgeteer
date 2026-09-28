/**
 * Household member income shares — the fraction of SHARED expenses and
 * savings each member carries.
 *
 * Shares are proportional to each member's allocated gross income. When the
 * household has no allocated income, members split equally (the same
 * fallback /transfers/breakdown uses). Shares are unrounded Decimals; round
 * only for display (formatSharePct) or use splitByShares to turn a total into
 * cent amounts that add up exactly.
 */
import { Decimal } from '@prisma/client/runtime/client'

const ZERO = new Decimal(0)

/**
 * @param memberIds       household members, in display order
 * @param grossByUserId   each user's allocated monthly gross income
 * @returns userId -> share in [0, 1]; shares sum to 1 when there are members
 */
export function computeIncomeShares(memberIds: string[], grossByUserId: Map<string, Decimal>): Map<string, Decimal> {
  const shares = new Map<string, Decimal>()
  if (memberIds.length === 0) return shares

  const grossOf = (id: string) => {
    const g = grossByUserId.get(id)
    return g && g.gt(0) ? new Decimal(g.toString()) : ZERO
  }
  const total = memberIds.reduce((s, id) => s.plus(grossOf(id)), ZERO)

  if (total.gt(0)) {
    for (const id of memberIds) shares.set(id, grossOf(id).div(total))
  } else {
    const equal = new Decimal(1).div(memberIds.length)
    for (const id of memberIds) shares.set(id, equal)
  }
  return shares
}

/** Share as a display percentage with one decimal, e.g. "33.3". */
export function formatSharePct(share: Decimal | undefined): string {
  return (share ?? ZERO).mul(100).toFixed(1)
}

/**
 * Split a total into cent amounts by share using the largest-remainder
 * method, so the parts always add up to the total rounded to cents
 * (100 split three ways → 33.34 + 33.33 + 33.33).
 */
export function splitByShares(total: Decimal | number, shares: Map<string, Decimal>): Map<string, Decimal> {
  const result = new Map<string, Decimal>()
  const ids = [...shares.keys()]
  if (ids.length === 0) return result

  const t = new Decimal(total.toString())
  const sign = t.isNegative() ? -1 : 1
  const totalCents = t.abs().mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)

  const shareSum = ids.reduce((s, id) => s.plus(shares.get(id)!), ZERO)
  if (shareSum.lte(0)) {
    for (const id of ids) result.set(id, ZERO)
    return result
  }

  const parts = ids.map((id, order) => {
    const exact = totalCents.mul(shares.get(id)!).div(shareSum)
    const floor = exact.floor()
    return { id, order, cents: floor, remainder: exact.minus(floor) }
  })

  let leftover = totalCents.minus(parts.reduce((s, p) => s.plus(p.cents), ZERO)).toNumber()
  const byRemainder = [...parts].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.order - b.order)
  for (const p of byRemainder) {
    if (leftover <= 0) break
    p.cents = p.cents.plus(1)
    leftover--
  }

  for (const p of parts) {
    const amount = p.cents.div(100)
    result.set(p.id, sign < 0 && !amount.isZero() ? amount.neg() : amount)
  }
  return result
}
