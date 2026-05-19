-- Add scoped receipt mappings so global defaults and household overrides can share the same table.
ALTER TABLE "ReceiptCategoryMapping" ADD COLUMN "scopeKey" TEXT;

UPDATE "ReceiptCategoryMapping"
SET "scopeKey" = "householdId";

ALTER TABLE "ReceiptCategoryMapping" ALTER COLUMN "scopeKey" SET NOT NULL;
ALTER TABLE "ReceiptCategoryMapping" ALTER COLUMN "scopeKey" SET DEFAULT 'system';
ALTER TABLE "ReceiptCategoryMapping" ALTER COLUMN "householdId" DROP NOT NULL;

DROP INDEX "ReceiptCategoryMapping_householdId_normalizedLabel_merchantKey_key";

CREATE UNIQUE INDEX "ReceiptCategoryMapping_scopeKey_normalizedLabel_merchantKey_key"
  ON "ReceiptCategoryMapping"("scopeKey", "normalizedLabel", "merchantKey");

CREATE INDEX "ReceiptCategoryMapping_scopeKey_categoryId_idx"
  ON "ReceiptCategoryMapping"("scopeKey", "categoryId");
