-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'AUTOMATIC';

-- AlterTable
ALTER TABLE "SavingsEntry" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'AUTOMATIC';
