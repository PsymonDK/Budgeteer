-- CreateEnum
CREATE TYPE "DismissReason" AS ENUM ('PAID_ELSEWHERE', 'SKIPPED');

-- AlterEnum
ALTER TYPE "OccurrenceStatus" ADD VALUE 'DISMISSED';

-- AlterTable
ALTER TABLE "ExpenseOccurrence" ADD COLUMN     "dismissReason" "DismissReason";

-- AlterTable
ALTER TABLE "SavingsOccurrence" ADD COLUMN     "dismissReason" "DismissReason";
