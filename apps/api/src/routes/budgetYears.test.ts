import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))
vi.mock('../plugins/authenticate', () => ({ authenticate: vi.fn() }))
vi.mock('../lib/budgetTransfer', () => ({ recalculateTransfer: vi.fn() }))

import { Prisma } from '@prisma/client'
import {
  canDeleteBudgetYear,
  copiedCurrencyFields,
  deleteBudgetYearWithDependencies,
  getRestoredRegularBudgetStatus,
} from './budgetYears'

describe('budget year lifecycle helpers', () => {
  const currentYear = new Date().getFullYear()

  it('restores retired future regular years to FUTURE', () => {
    expect(getRestoredRegularBudgetStatus({
      id: 'future-year',
      year: currentYear + 1,
      status: 'RETIRED',
    }, currentYear)).toBe('FUTURE')
  })

  it('restores retired current regular years to ACTIVE', () => {
    expect(getRestoredRegularBudgetStatus({
      id: 'current-year',
      year: currentYear,
      status: 'RETIRED',
    }, currentYear)).toBe('ACTIVE')
  })

  it('does not restore past retired years', () => {
    expect(getRestoredRegularBudgetStatus({
      id: 'past-year',
      year: currentYear - 1,
      status: 'RETIRED',
    }, currentYear)).toBeNull()
  })

  it('keeps simulations deletable', () => {
    expect(canDeleteBudgetYear({
      id: 'simulation',
      year: currentYear,
      status: 'SIMULATION',
    }, currentYear)).toBe(true)
  })

  it('allows deleting retired current or future regular years', () => {
    expect(canDeleteBudgetYear({
      id: 'current-year',
      year: currentYear,
      status: 'RETIRED',
    }, currentYear)).toBe(true)
    expect(canDeleteBudgetYear({
      id: 'future-year',
      year: currentYear + 1,
      status: 'RETIRED',
    }, currentYear)).toBe(true)
  })

  it('rejects deleting active, future, and past retired regular years', () => {
    expect(canDeleteBudgetYear({
      id: 'active-year',
      year: currentYear,
      status: 'ACTIVE',
    }, currentYear)).toBe(false)
    expect(canDeleteBudgetYear({
      id: 'future-year',
      year: currentYear + 1,
      status: 'FUTURE',
    }, currentYear)).toBe(false)
    expect(canDeleteBudgetYear({
      id: 'past-year',
      year: currentYear - 1,
      status: 'RETIRED',
    }, currentYear)).toBe(false)
  })
})

describe('deleteBudgetYearWithDependencies', () => {
  it('removes dependent budget-year records and detaches copies before deleting the year', async () => {
    const tx = {
      expense: {
        findMany: vi.fn().mockResolvedValue([{ id: 'expense-1' }, { id: 'expense-2' }]),
        deleteMany: vi.fn(),
      },
      expenseOccurrence: { deleteMany: vi.fn() },
      expenseCustomSplit: { deleteMany: vi.fn() },
      savingsEntry: {
        findMany: vi.fn().mockResolvedValue([{ id: 'savings-1' }]),
        deleteMany: vi.fn(),
      },
      savingsOccurrence: { deleteMany: vi.fn() },
      savingsCustomSplit: { deleteMany: vi.fn() },
      householdIncomeAllocation: { deleteMany: vi.fn() },
      budgetTransfer: { deleteMany: vi.fn() },
      budgetYear: {
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    }

    await deleteBudgetYearWithDependencies(tx as never, 'budget-year-1')

    expect(tx.expenseOccurrence.deleteMany).toHaveBeenCalledWith({
      where: { expenseId: { in: ['expense-1', 'expense-2'] } },
    })
    expect(tx.expenseCustomSplit.deleteMany).toHaveBeenCalledWith({
      where: { expenseId: { in: ['expense-1', 'expense-2'] } },
    })
    expect(tx.expense.deleteMany).toHaveBeenCalledWith({ where: { budgetYearId: 'budget-year-1' } })

    expect(tx.savingsOccurrence.deleteMany).toHaveBeenCalledWith({
      where: { savingsEntryId: { in: ['savings-1'] } },
    })
    expect(tx.savingsCustomSplit.deleteMany).toHaveBeenCalledWith({
      where: { savingsEntryId: { in: ['savings-1'] } },
    })
    expect(tx.savingsEntry.deleteMany).toHaveBeenCalledWith({ where: { budgetYearId: 'budget-year-1' } })

    expect(tx.householdIncomeAllocation.deleteMany).toHaveBeenCalledWith({ where: { budgetYearId: 'budget-year-1' } })
    expect(tx.budgetTransfer.deleteMany).toHaveBeenCalledWith({ where: { budgetYearId: 'budget-year-1' } })
    expect(tx.budgetYear.updateMany).toHaveBeenCalledWith({
      where: { copiedFromId: 'budget-year-1' },
      data: { copiedFromId: null },
    })
    expect(tx.budgetYear.delete).toHaveBeenCalledWith({ where: { id: 'budget-year-1' } })
  })
})

describe('copiedCurrencyFields', () => {
  const base = {
    amount: new Prisma.Decimal(100),
    originalAmount: new Prisma.Decimal(100),
    rateUsed: new Prisma.Decimal('7.40'),
    monthlyEquivalent: new Prisma.Decimal('740.00'),
    frequency: 'MONTHLY' as const,
    startMonth: null,
    endMonth: null,
  }

  it('keeps the currency and re-prices at the latest rate, unlocked', () => {
    const fields = copiedCurrencyFields(
      { ...base, currencyCode: 'EUR' },
      new Map([['EUR', new Prisma.Decimal('7.46')]]),
    )
    expect(fields.currencyCode).toBe('EUR')
    expect(fields.rateDate).toBeNull()
    expect(fields.rateUsed?.toString()).toBe('7.46')
    expect(fields.monthlyEquivalent.toFixed(2)).toBe('746.00')
  })

  it('falls back to the source rate when no current rate exists', () => {
    const fields = copiedCurrencyFields({ ...base, currencyCode: 'EUR' }, new Map([['EUR', null]]))
    expect(fields.rateUsed?.toString()).toBe('7.4')
    expect(fields.monthlyEquivalent.toFixed(2)).toBe('740.00')
  })

  it('leaves base-currency entries unchanged', () => {
    const fields = copiedCurrencyFields({ ...base, currencyCode: null, rateUsed: null }, new Map())
    expect(fields).toMatchObject({ currencyCode: null, originalAmount: null, rateUsed: null })
    expect(fields.monthlyEquivalent.toString()).toBe('740')
  })
})
