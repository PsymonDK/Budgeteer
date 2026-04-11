-- PAY-002 rework: replace 7 individual deduction columns with payslipLines JSON
-- Fixes: pension employee + ATP are pre-AM deductions (reduce AM base before AM-bidrag)
-- Adds pensionEmployerMonthly as separate field (employer cost, not deducted from net)

-- SalaryRecord: drop old columns, add new
ALTER TABLE "SalaryRecord"
  DROP COLUMN IF EXISTS "amBidragAmount",
  DROP COLUMN IF EXISTS "aSkattAmount",
  DROP COLUMN IF EXISTS "pensionEmployeeAmount",
  DROP COLUMN IF EXISTS "pensionEmployerAmount",
  DROP COLUMN IF EXISTS "atpAmount",
  DROP COLUMN IF EXISTS "bruttoDeductionAmount",
  DROP COLUMN IF EXISTS "otherDeductions";

ALTER TABLE "SalaryRecord"
  ADD COLUMN "payslipLines"           JSONB,
  ADD COLUMN "pensionEmployerMonthly" DECIMAL(10,2);

-- MonthlyIncomeOverride: drop old columns, add new
ALTER TABLE "MonthlyIncomeOverride"
  DROP COLUMN IF EXISTS "amBidragAmount",
  DROP COLUMN IF EXISTS "aSkattAmount",
  DROP COLUMN IF EXISTS "pensionEmployeeAmount",
  DROP COLUMN IF EXISTS "pensionEmployerAmount",
  DROP COLUMN IF EXISTS "atpAmount",
  DROP COLUMN IF EXISTS "bruttoDeductionAmount",
  DROP COLUMN IF EXISTS "otherDeductions";

ALTER TABLE "MonthlyIncomeOverride"
  ADD COLUMN "payslipLines"           JSONB,
  ADD COLUMN "pensionEmployerMonthly" DECIMAL(10,2);

-- Reset deductionsSource on existing rows (values were calculated with buggy order)
UPDATE "SalaryRecord" SET "deductionsSource" = NULL WHERE "deductionsSource" IS NOT NULL;
UPDATE "MonthlyIncomeOverride" SET "deductionsSource" = NULL WHERE "deductionsSource" IS NOT NULL;
