-- AlterTable
ALTER TABLE "Bonus" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "MonthlyIncomeOverride" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "SalaryRecord" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "SavingsEntry" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "TaxCardSettings" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Bonus_jobId_idx" ON "Bonus"("jobId");

-- CreateIndex
CREATE INDEX "Expense_budgetYearId_idx" ON "Expense"("budgetYearId");

-- CreateIndex
CREATE INDEX "SavingsEntry_budgetYearId_idx" ON "SavingsEntry"("budgetYearId");
