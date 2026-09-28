import { describe, it, expect } from 'vitest'
import { includingTrashed, withTrashFilter } from './prisma'

describe('withTrashFilter', () => {
  it('hides trashed rows by default', () => {
    expect(withTrashFilter({ where: { budgetYearId: 'by1' } })).toEqual({ where: { budgetYearId: 'by1', deletedAt: null } })
    expect(withTrashFilter({})).toEqual({ where: { deletedAt: null } })
  })

  it('leaves queries that ask about deletedAt themselves alone (the trash)', () => {
    const trash = { where: { deletedAt: { not: null } } }
    expect(withTrashFilter(trash)).toBe(trash)
  })

  it('can be opted out of explicitly', () => {
    const args = { where: { categoryId: 'c1', ...includingTrashed } }
    expect(withTrashFilter(args).where).toEqual({ categoryId: 'c1', deletedAt: undefined })
  })

  it('does not mutate the caller\'s args', () => {
    const args = { where: { id: 'x' } }
    withTrashFilter(args)
    expect(args).toEqual({ where: { id: 'x' } })
  })
})
