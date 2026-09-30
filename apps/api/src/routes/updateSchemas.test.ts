import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))
vi.mock('../plugins/authenticate', () => ({ authenticate: vi.fn() }))
vi.mock('../lib/budgetTransfer', () => ({ recalculateTransfer: vi.fn() }))

import { BulkUpdateExpenseSchema, CreateExpenseSchema, UpdateExpenseSchema } from './expenses'
import { BulkUpdateSavingsSchema, CreateSavingsSchema, UpdateSavingsSchema } from './savings'
import { CreateJobSchema, UpdateJobSchema } from './jobs'
import { UpdateOccurrenceSchema } from './occurrences'

// Zod 4 applies .default() values inside .partial() schemas too. Update schemas
// must not carry defaults, or a PATCH that leaves a field out would reset it.
describe('update schemas leave omitted fields untouched', () => {
  it('expense update does not reset ownership', () => {
    const data = UpdateExpenseSchema.parse({ label: 'Rent' })
    expect(data).toEqual({ label: 'Rent' })
    expect('ownership' in data).toBe(false)
  })

  it('savings update does not reset ownership', () => {
    const data = UpdateSavingsSchema.parse({ amount: 100 })
    expect(data).toEqual({ amount: 100 })
  })

  it('job update does not reset country', () => {
    const data = UpdateJobSchema.parse({ name: 'Engineer' })
    expect(data).toEqual({ name: 'Engineer' })
  })

  it('an empty update is still rejected', () => {
    expect(UpdateExpenseSchema.safeParse({}).success).toBe(false)
    expect(UpdateSavingsSchema.safeParse({}).success).toBe(false)
    expect(UpdateJobSchema.safeParse({}).success).toBe(false)
  })
})

describe('create schemas keep their defaults', () => {
  it('expense and savings default to SHARED ownership', () => {
    const expense = CreateExpenseSchema.parse({ label: 'Rent', amount: 100, frequency: 'MONTHLY', categoryId: 'c1' })
    expect(expense.ownership).toBe('SHARED')
    const savings = CreateSavingsSchema.parse({ label: 'Buffer', amount: 50, frequency: 'MONTHLY' })
    expect(savings.ownership).toBe('SHARED')
  })

  it('job defaults to DK and upper-cases a given country', () => {
    expect(CreateJobSchema.parse({ name: 'Engineer', startDate: '2026-01-01' }).country).toBe('DK')
    expect(CreateJobSchema.parse({ name: 'Engineer', startDate: '2026-01-01', country: 'se' }).country).toBe('SE')
    expect(UpdateJobSchema.parse({ country: 'no' }).country).toBe('NO')
  })

  it('expense month range is still validated on create and update', () => {
    const base = { label: 'Rent', amount: 100, frequency: 'MONTHLY', categoryId: 'c1' }
    expect(CreateExpenseSchema.safeParse({ ...base, startMonth: 9, endMonth: 3 }).success).toBe(false)
    expect(UpdateExpenseSchema.safeParse({ startMonth: 9, endMonth: 3 }).success).toBe(false)
  })
})

describe('dueDay', () => {
  const expense = { label: 'Rent', amount: 100, frequency: 'MONTHLY', categoryId: 'c1' }
  const savings = { label: 'Buffer', amount: 100, frequency: 'MONTHLY' }

  it('accepts days 1–31 and null (clears it)', () => {
    for (const dueDay of [1, 15, 31, null]) {
      expect(CreateExpenseSchema.safeParse({ ...expense, dueDay }).success).toBe(true)
      expect(CreateSavingsSchema.safeParse({ ...savings, dueDay }).success).toBe(true)
      expect(UpdateExpenseSchema.safeParse({ dueDay }).success).toBe(true)
      expect(UpdateSavingsSchema.safeParse({ dueDay }).success).toBe(true)
    }
  })

  it('rejects days outside 1–31 and fractions', () => {
    for (const dueDay of [0, 32, -1, 1.5]) {
      expect(CreateExpenseSchema.safeParse({ ...expense, dueDay }).success).toBe(false)
      expect(CreateSavingsSchema.safeParse({ ...savings, dueDay }).success).toBe(false)
      expect(UpdateExpenseSchema.safeParse({ dueDay }).success).toBe(false)
      expect(UpdateSavingsSchema.safeParse({ dueDay }).success).toBe(false)
    }
  })

  it('stays out of updates that leave it out', () => {
    expect('dueDay' in UpdateExpenseSchema.parse({ label: 'Rent' })).toBe(false)
    expect('dueDay' in UpdateSavingsSchema.parse({ label: 'Buffer' })).toBe(false)
  })
})

describe('paymentMethod', () => {
  const expense = { label: 'Rent', amount: 100, frequency: 'MONTHLY', categoryId: 'c1' }
  const savings = { label: 'Buffer', amount: 100, frequency: 'MONTHLY' }

  it('defaults to AUTOMATIC on create', () => {
    expect(CreateExpenseSchema.parse(expense).paymentMethod).toBe('AUTOMATIC')
    expect(CreateSavingsSchema.parse(savings).paymentMethod).toBe('AUTOMATIC')
  })

  it('accepts MANUAL and rejects other values', () => {
    expect(CreateExpenseSchema.parse({ ...expense, paymentMethod: 'MANUAL' }).paymentMethod).toBe('MANUAL')
    expect(UpdateSavingsSchema.parse({ paymentMethod: 'MANUAL' }).paymentMethod).toBe('MANUAL')
    expect(CreateExpenseSchema.safeParse({ ...expense, paymentMethod: 'CARD' }).success).toBe(false)
    expect(UpdateExpenseSchema.safeParse({ paymentMethod: 'manual' }).success).toBe(false)
  })

  it('stays out of updates that leave it out', () => {
    expect('paymentMethod' in UpdateExpenseSchema.parse({ label: 'Rent' })).toBe(false)
    expect('paymentMethod' in UpdateSavingsSchema.parse({ label: 'Buffer' })).toBe(false)
  })

  it('is enough on its own for a bulk edit', () => {
    expect(BulkUpdateExpenseSchema.safeParse({ ids: ['e1'], paymentMethod: 'MANUAL' }).success).toBe(true)
    expect(BulkUpdateSavingsSchema.safeParse({ ids: ['s1'], paymentMethod: 'AUTOMATIC' }).success).toBe(true)
    expect(BulkUpdateExpenseSchema.safeParse({ ids: ['e1'] }).success).toBe(false)
  })
})

describe('UpdateOccurrenceSchema', () => {
  it('marks paid or pending without a reason', () => {
    expect(UpdateOccurrenceSchema.safeParse({ status: 'PAID' }).success).toBe(true)
    expect(UpdateOccurrenceSchema.safeParse({ status: 'PENDING' }).success).toBe(true)
  })

  it('needs a reason to dismiss, and only the known ones', () => {
    expect(UpdateOccurrenceSchema.safeParse({ status: 'DISMISSED', reason: 'PAID_ELSEWHERE' }).success).toBe(true)
    expect(UpdateOccurrenceSchema.safeParse({ status: 'DISMISSED', reason: 'SKIPPED' }).success).toBe(true)
    expect(UpdateOccurrenceSchema.safeParse({ status: 'DISMISSED' }).success).toBe(false)
    expect(UpdateOccurrenceSchema.safeParse({ status: 'DISMISSED', reason: 'FORGOT' }).success).toBe(false)
  })

  it('cannot close a month by hand', () => {
    expect(UpdateOccurrenceSchema.safeParse({ status: 'SKIPPED' }).success).toBe(false)
  })
})
