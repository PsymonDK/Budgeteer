-- AlterTable: how the household's monthly transfer is paid, and when it's due
ALTER TABLE "Household" ADD COLUMN     "transferPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "transferDueDay" INTEGER NOT NULL DEFAULT 1;

-- Existing households keep their behaviour: auto-marked transfers become automatic, the rest manual
UPDATE "Household" SET "transferPaymentMethod" = 'AUTOMATIC' WHERE "autoMarkTransferPaid" = true;

-- AlterTable: replaced by transferPaymentMethod
ALTER TABLE "Household" DROP COLUMN "autoMarkTransferPaid";
