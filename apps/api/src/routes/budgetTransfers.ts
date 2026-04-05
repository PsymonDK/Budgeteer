import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { assertBudgetYearAccess, resolveEffectiveAmount } from '../lib/ownership'
import { recalculateTransfer } from '../lib/budgetTransfer'
import { calcIncomeForYear, getIncomeReferenceDate } from '../lib/incomeCalc'

const MarkPaidSchema = z.object({
  actualAmount: z.number().positive(),
})

export async function budgetTransferRoutes(fastify: FastifyInstance) {
  // GET /budget-years/:id/transfers
  fastify.get('/budget-years/:id/transfers', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const transfers = await prisma.budgetTransfer.findMany({
      where: { budgetYearId: id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })

    return reply.send(transfers)
  })

  // PATCH /budget-years/:id/transfers/:transferId/mark-paid
  fastify.patch('/budget-years/:id/transfers/:transferId/mark-paid', { preHandler: authenticate }, async (request, reply) => {
    const { id, transferId } = request.params as { id: string; transferId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const result = MarkPaidSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }

    const transfer = await prisma.budgetTransfer.findUnique({ where: { id: transferId } })
    if (!transfer || transfer.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Transfer not found' })
    }

    const { actualAmount } = result.data
    const calculatedAmount = parseFloat(transfer.calculatedAmount.toString())
    const status = actualAmount === calculatedAmount ? 'PAID' : 'ADJUSTED'

    const updated = await prisma.budgetTransfer.update({
      where: { id: transferId },
      data: {
        actualAmount: new Decimal(actualAmount),
        status,
        paidAt: new Date(),
      },
    })

    recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    return reply.send(updated)
  })

  // PATCH /budget-years/:id/transfers/:transferId/mark-pending
  fastify.patch('/budget-years/:id/transfers/:transferId/mark-pending', { preHandler: authenticate }, async (request, reply) => {
    const { id, transferId } = request.params as { id: string; transferId: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const transfer = await prisma.budgetTransfer.findUnique({ where: { id: transferId } })
    if (!transfer || transfer.budgetYearId !== id) {
      return reply.status(404).send({ error: 'Transfer not found' })
    }

    const updated = await prisma.budgetTransfer.update({
      where: { id: transferId },
      data: {
        status: 'PENDING',
        actualAmount: null,
        paidAt: null,
      },
    })

    recalculateTransfer(id).catch((err) => fastify.log.error({ err }, 'recalculateTransfer failed'))

    return reply.send(updated)
  })

  // GET /budget-years/:id/transfers/breakdown
  // Returns monthly transfer amounts broken down by account and by household member.
  fastify.get('/budget-years/:id/transfers/breakdown', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { sub: userId, role } = request.user

    const budgetYear = await assertBudgetYearAccess(id, userId, role === 'SYSTEM_ADMIN')
    if (!budgetYear) return reply.status(403).send({ error: 'Forbidden' })

    const budgetModel = budgetYear.household.budgetModel
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    // Find the next pending transfer so the breakdown always reflects what's due next,
    // not necessarily the current calendar month (which may already be paid).
    const nextPending = await prisma.budgetTransfer.findFirst({
      where: { budgetYearId: id, status: 'PENDING' },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    })
    const targetMonth = nextPending?.month ?? currentMonth
    const targetYear = nextPending?.year ?? currentYear

    const [expenses, savings, members] = await Promise.all([
      prisma.expense.findMany({
        where: { budgetYearId: id },
        select: {
          id: true,
          monthlyEquivalent: true,
          forwardMonthlyEquivalent: true,
          ownership: true,
          ownedByUserId: true,
          account: { select: { id: true, name: true, type: true } },
          customSplits: { select: { userId: true, pct: true } },
        },
      }),
      prisma.savingsEntry.findMany({
        where: { budgetYearId: id },
        select: {
          id: true,
          monthlyEquivalent: true,
          forwardMonthlyEquivalent: true,
          ownership: true,
          ownedByUserId: true,
          account: { select: { id: true, name: true, type: true } },
          customSplits: { select: { userId: true, pct: true } },
        },
      }),
      prisma.householdMember.findMany({
        where: { household: { budgetYears: { some: { id } } } },
        select: { userId: true, user: { select: { id: true, name: true } } },
      }),
    ])

    // Fetch current-month occurrences for PAY_NO_PAY model
    let expOccMap = new Map<string, { scheduledAmount: { toString(): string }; carriedAmount: { toString(): string } }>()
    let savOccMap = new Map<string, { scheduledAmount: { toString(): string }; carriedAmount: { toString(): string } }>()

    if (budgetModel === 'PAY_NO_PAY') {
      const [expOccs, savOccs] = await Promise.all([
        prisma.expenseOccurrence.findMany({
          where: { expense: { budgetYearId: id }, year: targetYear, month: targetMonth, status: 'PENDING' },
          select: { expenseId: true, scheduledAmount: true, carriedAmount: true },
        }),
        prisma.savingsOccurrence.findMany({
          where: { savingsEntry: { budgetYearId: id }, year: targetYear, month: targetMonth, status: 'PENDING' },
          select: { savingsEntryId: true, scheduledAmount: true, carriedAmount: true },
        }),
      ])
      expOccMap = new Map(expOccs.map((o) => [o.expenseId, o]))
      savOccMap = new Map(savOccs.map((o) => [o.savingsEntryId, o]))
    }

    const memberIds = members.map((m) => m.userId)
    const memberCount = memberIds.length

    // Compute income share per member for SHARED expense/savings allocation.
    // Falls back to equal split if no income is allocated.
    const refDate = getIncomeReferenceDate(budgetYear.year, budgetYear.status)
    const incomeResult = await calcIncomeForYear(id, refDate)
    const totalGross = incomeResult.totalMonthlyGross
    const memberShareMap = new Map<string, number>()
    if (totalGross > 0) {
      for (const m of incomeResult.members) {
        memberShareMap.set(m.userId, m.monthlyAllocatedGross / totalGross)
      }
    } else {
      const equalShare = memberCount > 0 ? 1 / memberCount : 0
      for (const uid of memberIds) memberShareMap.set(uid, equalShare)
    }

    // Accumulator types
    type AccountKey = string // accountId or '__untagged__'
    const accountMap = new Map<AccountKey, { accountId: string | null; accountName: string; accountType: string | null; total: number }>()
    const memberMap = new Map<string, { userId: string; name: string; byAccount: Map<AccountKey, number> }>()

    for (const m of members) {
      memberMap.set(m.userId, { userId: m.userId, name: m.user.name, byAccount: new Map() })
    }

    const addToAccount = (accountKey: AccountKey, accountId: string | null, accountName: string, accountType: string | null, amount: number) => {
      const existing = accountMap.get(accountKey)
      if (existing) {
        existing.total += amount
      } else {
        accountMap.set(accountKey, { accountId, accountName, accountType, total: amount })
      }
    }

    const addToMember = (userId: string, accountKey: AccountKey, amount: number) => {
      const member = memberMap.get(userId)
      if (!member) return
      member.byAccount.set(accountKey, (member.byAccount.get(accountKey) ?? 0) + amount)
    }

    const taggedExpenses = expenses.map((e) => ({ ...e, _kind: 'expense' as const }))
    const taggedSavings = savings.map((s) => ({ ...s, _kind: 'savings' as const }))
    const allItems = [...taggedExpenses, ...taggedSavings]

    for (const item of allItems) {
      const occ = budgetModel === 'PAY_NO_PAY'
        ? (item._kind === 'expense' ? expOccMap.get(item.id) : savOccMap.get(item.id))
        : undefined
      const me = resolveEffectiveAmount(item, budgetModel, occ)
      const accountKey = item.account?.id ?? '__untagged__'
      const accountId = item.account?.id ?? null
      const accountName = item.account?.name ?? 'Untagged'
      const accountType = item.account?.type ?? null

      addToAccount(accountKey, accountId, accountName, accountType, me)

      if (item.ownership === 'INDIVIDUAL' && item.ownedByUserId) {
        addToMember(item.ownedByUserId, accountKey, me)
      } else if (item.customSplits.length > 0) {
        for (const split of item.customSplits) {
          addToMember(split.userId, accountKey, me * parseFloat(split.pct.toString()) / 100)
        }
      } else {
        // SHARED: split by income share (consistent with summary memberSplits)
        for (const uid of memberIds) {
          const share = memberShareMap.get(uid) ?? (memberCount > 0 ? 1 / memberCount : 0)
          addToMember(uid, accountKey, me * share)
        }
      }
    }

    const byAccount = Array.from(accountMap.values()).map((a) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      accountType: a.accountType,
      monthlyAmount: Math.round(a.total * 100) / 100,
    }))

    const byMember = Array.from(memberMap.values()).map((m) => {
      const accountEntries = Array.from(m.byAccount.entries()).map(([key, amount]) => {
        const acct = accountMap.get(key)!
        return {
          accountId: acct.accountId,
          accountName: acct.accountName,
          monthlyAmount: Math.round(amount * 100) / 100,
        }
      })
      const monthlyTotal = Math.round(accountEntries.reduce((s, a) => s + a.monthlyAmount, 0) * 100) / 100
      return { userId: m.userId, name: m.name, monthlyTotal, byAccount: accountEntries }
    })

    return reply.send({ byAccount, byMember })
  })
}
