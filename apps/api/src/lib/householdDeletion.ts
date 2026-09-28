import type { PrismaTx } from './prisma'
import { deleteBudgetYearWithDependencies } from '../routes/budgetYears'

/**
 * Hard-deletes a household and everything that belongs to it (system-admin action).
 * Budget years, members and automations have no cascading foreign keys, so they are
 * removed explicitly; receipts, accounts and receipt classifier data cascade.
 */
export async function deleteHouseholdWithDependencies(tx: PrismaTx, householdId: string): Promise<void> {
  const budgetYears = await tx.budgetYear.findMany({ where: { householdId }, select: { id: true } })
  // Copies reference their source year; clear those links first so deletion order doesn't matter
  await tx.budgetYear.updateMany({ where: { householdId }, data: { copiedFromId: null } })
  for (const { id } of budgetYears) await deleteBudgetYearWithDependencies(tx, id)

  await tx.automationRun.deleteMany({ where: { automation: { householdId } } })
  await tx.automation.deleteMany({ where: { householdId } })
  await tx.householdMember.deleteMany({ where: { householdId } })

  // Custom categories aren't linked by a foreign key. Delete the unreferenced ones
  // and deactivate any still referenced elsewhere rather than failing the delete.
  await tx.category.deleteMany({
    where: { householdId, isSystemWide: false, expenses: { none: {} }, savingsEntries: { none: {} } },
  })
  await tx.category.updateMany({ where: { householdId, isSystemWide: false }, data: { isActive: false } })

  await tx.household.delete({ where: { id: householdId } })
}
