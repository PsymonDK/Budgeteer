import type { Decimal } from '@prisma/client/runtime/client'

/** Convert a Prisma Decimal (or null/undefined) to a plain JS number. */
export function toNum(d: Decimal | null | undefined): number {
  return d ? parseFloat(d.toString()) : 0
}
