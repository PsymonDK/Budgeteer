import type { FastifyReply } from 'fastify'
import { prisma } from './prisma'

// ── Internal ──────────────────────────────────────────────────────────────────

async function isMember(householdId: string, userId: string): Promise<boolean> {
  const m = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
  return m !== null
}

// ── Budget year access ────────────────────────────────────────────────────────

export async function assertBudgetYearAccess(budgetYearId: string, userId: string, systemAdmin: boolean) {
  const by = await prisma.budgetYear.findUnique({
    where: { id: budgetYearId },
    include: { household: { include: { members: { where: { userId } } } } },
  })
  if (!by) return null
  if (!systemAdmin && by.household.members.length === 0) return null
  return by
}

// ── Ownership validation ──────────────────────────────────────────────────────

export async function validateOwnership(
  ownership: 'SHARED' | 'INDIVIDUAL' | 'CUSTOM',
  ownedByUserId: string | null | undefined,
  customSplits: { userId: string; pct: number }[] | undefined,
  householdId: string,
): Promise<string | null> {
  if (ownership === 'SHARED') return null

  if (ownership === 'INDIVIDUAL') {
    if (!ownedByUserId) return 'ownedByUserId is required for INDIVIDUAL ownership'
    if (!await isMember(householdId, ownedByUserId)) return 'Assigned user is not a member of this household'
    return null
  }

  // CUSTOM
  if (!customSplits || customSplits.length === 0) return 'customSplits are required for CUSTOM ownership'
  for (const split of customSplits) {
    if (!await isMember(householdId, split.userId)) return `User ${split.userId} is not a member of this household`
  }
  const total = customSplits.reduce((s, c) => s + c.pct, 0)
  if (Math.abs(total - 100) > 0.01) return `Custom split percentages must sum to 100 (got ${total.toFixed(2)})`
  return null
}

// ── Route-level household access guard ───────────────────────────────────────

/**
 * Checks that the caller is a member of the household (or a SYSTEM_ADMIN).
 * Sends a 403 and returns false if not — the caller should `return` immediately.
 */
export async function assertHouseholdAccess(
  householdId: string,
  userId: string,
  role: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (role === 'SYSTEM_ADMIN') return true
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  })
  if (!member) {
    reply.status(403).send({ error: 'Forbidden' })
    return false
  }
  return true
}

// ── Ownership-split partitioning ─────────────────────────────────────────────

interface OwnershipItem {
  ownership: string
  monthlyEquivalent: { toString(): string }
  ownedByUserId?: string | null
  customSplits: Array<{ userId: string; pct: { toString(): string } }>
}

/**
 * Splits a list of expenses or savings entries into shared total, per-user
 * individual totals, and per-user custom-split totals (all in monthly equivalents).
 */
export function partitionByOwnership(items: OwnershipItem[]): {
  shared: number
  individual: Map<string, number>
  custom: Map<string, number>
} {
  let shared = 0
  const individual = new Map<string, number>()
  const custom = new Map<string, number>()

  for (const item of items) {
    const monthly = parseFloat(item.monthlyEquivalent.toString())
    if (item.ownership === 'SHARED') {
      shared += monthly
    } else if (item.ownership === 'INDIVIDUAL' && item.ownedByUserId) {
      individual.set(item.ownedByUserId, (individual.get(item.ownedByUserId) ?? 0) + monthly)
    } else if (item.ownership === 'CUSTOM') {
      for (const split of item.customSplits) {
        const pct = parseFloat(split.pct.toString()) / 100
        custom.set(split.userId, (custom.get(split.userId) ?? 0) + monthly * pct)
      }
    }
  }

  return { shared, individual, custom }
}

// ── Budget-model-aware amount resolution ─────────────────────────────────────

type BudgetModelType = 'AVERAGE' | 'FORWARD_LOOKING' | 'PAY_NO_PAY'

interface OccurrenceAmounts {
  scheduledAmount: { toString(): string }
  carriedAmount: { toString(): string }
}

/**
 * Resolves the effective monthly amount for one item given the household's budget model.
 *
 * - AVERAGE: always monthlyEquivalent
 * - FORWARD_LOOKING: forwardMonthlyEquivalent if set, else monthlyEquivalent.
 *   Note: SavingsEntry.forwardMonthlyEquivalent is not written by recalculateForwardLooking
 *   (only expenses are), so savings entries always fall back to monthlyEquivalent here.
 * - PAY_NO_PAY: scheduledAmount + carriedAmount from the occurrence row, or monthlyEquivalent
 *   if no occurrence has been seeded yet for this month.
 */
export function resolveEffectiveAmount(
  item: {
    monthlyEquivalent: { toString(): string }
    forwardMonthlyEquivalent?: { toString(): string } | null
  },
  budgetModel: BudgetModelType,
  occurrence?: OccurrenceAmounts | null,
): number {
  if (budgetModel === 'FORWARD_LOOKING' && item.forwardMonthlyEquivalent != null) {
    return parseFloat(item.forwardMonthlyEquivalent.toString())
  }
  if (budgetModel === 'PAY_NO_PAY' && occurrence != null) {
    return (
      parseFloat(occurrence.scheduledAmount.toString()) +
      parseFloat(occurrence.carriedAmount.toString())
    )
  }
  return parseFloat(item.monthlyEquivalent.toString())
}

/**
 * Same partitioning logic as partitionByOwnership, but reads a pre-resolved
 * effectiveAmount field instead of monthlyEquivalent. Use after calling
 * resolveEffectiveAmount on each item.
 */
export function partitionByEffectiveAmount(
  items: Array<OwnershipItem & { effectiveAmount: number }>,
): {
  shared: number
  individual: Map<string, number>
  custom: Map<string, number>
} {
  let shared = 0
  const individual = new Map<string, number>()
  const custom = new Map<string, number>()

  for (const item of items) {
    const monthly = item.effectiveAmount
    if (item.ownership === 'SHARED') {
      shared += monthly
    } else if (item.ownership === 'INDIVIDUAL' && item.ownedByUserId) {
      individual.set(item.ownedByUserId, (individual.get(item.ownedByUserId) ?? 0) + monthly)
    } else if (item.ownership === 'CUSTOM') {
      for (const split of item.customSplits) {
        const pct = parseFloat(split.pct.toString()) / 100
        custom.set(split.userId, (custom.get(split.userId) ?? 0) + monthly * pct)
      }
    }
  }

  return { shared, individual, custom }
}
