-- Runs before `prisma db push` (SCHEMA_SYNC_MODE=push / force-push) on every container start.
--
-- `db push` compares the database with schema.prisma and does not run the SQL in
-- prisma/migrations, so a migration that moves data out of a column before dropping it
-- would stop push (it refuses to drop a column with data) or lose that data (force-push).
-- Such data steps are repeated here. Each block checks whether it's still needed, so the
-- script is a no-op on a fresh database and on one that is already up to date.

-- 20260930131500_transfer_payment_method: Household.autoMarkTransferPaid → transferPaymentMethod
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Household' AND column_name = 'autoMarkTransferPaid'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'PaymentMethod' AND n.nspname = current_schema()
    ) THEN
      CREATE TYPE "PaymentMethod" AS ENUM ('AUTOMATIC', 'MANUAL');
    END IF;

    ALTER TABLE "Household"
      ADD COLUMN IF NOT EXISTS "transferPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'MANUAL',
      ADD COLUMN IF NOT EXISTS "transferDueDay" INTEGER NOT NULL DEFAULT 1;

    UPDATE "Household" SET "transferPaymentMethod" = 'AUTOMATIC' WHERE "autoMarkTransferPaid" = true;

    ALTER TABLE "Household" DROP COLUMN "autoMarkTransferPaid";
  END IF;
END $$;
