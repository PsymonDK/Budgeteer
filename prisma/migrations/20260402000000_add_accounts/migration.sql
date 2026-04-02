-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'CREDIT_CARD', 'MOBILE_PAY');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownedByUserId" TEXT,
    "householdId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "accountId" TEXT;

-- AlterTable
ALTER TABLE "SavingsEntry" ADD COLUMN "accountId" TEXT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownedByUserId_fkey" FOREIGN KEY ("ownedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
