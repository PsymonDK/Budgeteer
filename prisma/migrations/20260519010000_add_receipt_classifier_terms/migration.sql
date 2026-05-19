CREATE TYPE "ReceiptClassifierTermType" AS ENUM ('NOISE_TOKEN', 'LOW_VALUE_WORD', 'OCR_ALIAS');

CREATE TABLE "ReceiptClassifierTerm" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT 'system',
  "householdId" TEXT,
  "termType" "ReceiptClassifierTermType" NOT NULL,
  "term" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'SYSTEM',
  "hitCount" INTEGER NOT NULL DEFAULT 0,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReceiptClassifierTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiptClassifierTerm_scopeKey_termType_term_key"
  ON "ReceiptClassifierTerm"("scopeKey", "termType", "term");

CREATE INDEX "ReceiptClassifierTerm_householdId_idx"
  ON "ReceiptClassifierTerm"("householdId");

CREATE INDEX "ReceiptClassifierTerm_termType_isActive_idx"
  ON "ReceiptClassifierTerm"("termType", "isActive");

ALTER TABLE "ReceiptClassifierTerm"
  ADD CONSTRAINT "ReceiptClassifierTerm_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ReceiptClassifierTerm" ("id", "termType", "term", "source")
VALUES
  ('system_noise_stk', 'NOISE_TOKEN', 'stk', 'SYSTEM'),
  ('system_noise_pcs', 'NOISE_TOKEN', 'pcs', 'SYSTEM'),
  ('system_noise_pc', 'NOISE_TOKEN', 'pc', 'SYSTEM'),
  ('system_noise_kg', 'NOISE_TOKEN', 'kg', 'SYSTEM'),
  ('system_noise_g', 'NOISE_TOKEN', 'g', 'SYSTEM'),
  ('system_noise_l', 'NOISE_TOKEN', 'l', 'SYSTEM'),
  ('system_noise_ml', 'NOISE_TOKEN', 'ml', 'SYSTEM'),
  ('system_noise_cl', 'NOISE_TOKEN', 'cl', 'SYSTEM'),
  ('system_noise_cm', 'NOISE_TOKEN', 'cm', 'SYSTEM'),
  ('system_noise_mm', 'NOISE_TOKEN', 'mm', 'SYSTEM'),
  ('system_noise_ltr', 'NOISE_TOKEN', 'ltr', 'SYSTEM'),
  ('system_noise_liter', 'NOISE_TOKEN', 'liter', 'SYSTEM'),
  ('system_noise_gram', 'NOISE_TOKEN', 'gram', 'SYSTEM'),
  ('system_noise_varenr', 'NOISE_TOKEN', 'varenr', 'SYSTEM'),
  ('system_noise_vare', 'NOISE_TOKEN', 'vare', 'SYSTEM'),
  ('system_noise_nr', 'NOISE_TOKEN', 'nr', 'SYSTEM'),
  ('system_noise_dk', 'NOISE_TOKEN', 'dk', 'SYSTEM'),
  ('system_noise_kr', 'NOISE_TOKEN', 'kr', 'SYSTEM'),
  ('system_noise_dkk', 'NOISE_TOKEN', 'dkk', 'SYSTEM'),
  ('system_low_total', 'LOW_VALUE_WORD', 'total', 'SYSTEM'),
  ('system_low_subtotal', 'LOW_VALUE_WORD', 'subtotal', 'SYSTEM'),
  ('system_low_sum', 'LOW_VALUE_WORD', 'sum', 'SYSTEM'),
  ('system_low_change', 'LOW_VALUE_WORD', 'change', 'SYSTEM'),
  ('system_low_cash', 'LOW_VALUE_WORD', 'cash', 'SYSTEM'),
  ('system_low_card', 'LOW_VALUE_WORD', 'card', 'SYSTEM'),
  ('system_low_visa', 'LOW_VALUE_WORD', 'visa', 'SYSTEM'),
  ('system_low_mastercard', 'LOW_VALUE_WORD', 'mastercard', 'SYSTEM'),
  ('system_low_dankort', 'LOW_VALUE_WORD', 'dankort', 'SYSTEM'),
  ('system_low_tax', 'LOW_VALUE_WORD', 'tax', 'SYSTEM'),
  ('system_low_vat', 'LOW_VALUE_WORD', 'vat', 'SYSTEM'),
  ('system_low_moms', 'LOW_VALUE_WORD', 'moms', 'SYSTEM')
ON CONFLICT DO NOTHING;
