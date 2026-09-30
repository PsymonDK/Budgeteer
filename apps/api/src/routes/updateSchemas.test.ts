import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/prisma', () => ({ prisma: {}, notDeleted: { deletedAt: null }, includingTrashed: { deletedAt: undefined } }))
vi.mock('../plugins/authenticate', () => ({ authenticate: vi.fn() }))
vi.mock('../lib/budgetTransfer', () => ({ recalculateTransfer: vi.fn() }))

import { CreateExpenseSchema, UpdateExpenseSchema } from './expenses'
import { CreateSavingsSchema, UpdateSavingsSchema } from './savings'
import { CreateJobSchema, UpdateJobSchema } from './jobs'

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
