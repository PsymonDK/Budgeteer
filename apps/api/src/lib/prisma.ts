import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const base = new PrismaClient({ adapter })

// Financial records are never hard-deleted by users: "delete" sets deletedAt and the
// row goes to the trash, from where it can be restored.
export const SOFT_DELETE_MODELS = new Set(['Expense', 'SavingsEntry', 'SalaryRecord', 'MonthlyIncomeOverride', 'Bonus', 'TaxCardSettings'])

// Reads and bulk updates that must not see trashed rows. Single-row update/delete by
// id are left alone: routes look the row up first (which is filtered), and the
// trash/restore and hard-delete paths need to reach trashed rows.
const FILTERED_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'updateMany',
])

/**
 * Adds `deletedAt: null` to a query's where clause unless the query already says
 * something about deletedAt (the trash queries ask for `{ not: null }`).
 * Nested includes and relation filters are not covered by this — those add
 * `deletedAt: null` explicitly (see notDeleted).
 */
export function withTrashFilter<T extends { where?: Record<string, unknown> }>(args: T): T {
  if (args.where && 'deletedAt' in args.where) return args
  return { ...args, where: { ...args.where, deletedAt: null } }
}

export const prisma = base.$extends({
  name: 'softDelete',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && SOFT_DELETE_MODELS.has(model) && FILTERED_OPERATIONS.has(operation)) {
          return query(withTrashFilter(args as { where?: Record<string, unknown> }) as typeof args)
        }
        return query(args)
      },
    },
  },
})

/** Where-fragment for nested includes and relation filters on trashable models. */
export const notDeleted = { deletedAt: null } as const

export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Opts a where clause out of the trash filter (`'deletedAt' in where` with an
 * undefined value filters nothing). For paths that must see trashed rows too,
 * such as reassigning a category's entries before deleting it.
 */
export const includingTrashed = { deletedAt: undefined } as const
