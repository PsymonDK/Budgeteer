-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SUCCESS', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PAID', 'ADJUSTED');

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "AutomationRunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "triggeredBy" "AutomationTrigger" NOT NULL,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "message" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTransfer" (
    "id" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "calculatedAmount" DECIMAL(10,2) NOT NULL,
    "actualAmount" DECIMAL(10,2),
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "automationRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Automation_householdId_key_key" ON "Automation"("householdId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTransfer_budgetYearId_month_year_key" ON "BudgetTransfer"("budgetYearId", "month", "year");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "BudgetYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
