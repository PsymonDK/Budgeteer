-- Add autoMarkTransferPaid setting to Household.
-- When enabled, the monthly automation marks the previous month's transfer as PAID automatically.
ALTER TABLE "Household" ADD COLUMN "autoMarkTransferPaid" BOOLEAN NOT NULL DEFAULT false;
