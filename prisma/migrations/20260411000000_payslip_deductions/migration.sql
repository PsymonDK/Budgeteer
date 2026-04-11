-- Sprint 25 (PAY-001): Payslip deduction breakdown
-- Adds country to Job, TaxCardSettings model,
-- and deduction fields to SalaryRecord + MonthlyIncomeOverride.

-- #169 – country on Job
ALTER TABLE "Job" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'DK';

-- #171 – deduction breakdown on SalaryRecord
ALTER TABLE "SalaryRecord"
  ADD COLUMN "amBidragAmount"        DECIMAL(10,2),
  ADD COLUMN "aSkattAmount"          DECIMAL(10,2),
  ADD COLUMN "pensionEmployeeAmount" DECIMAL(10,2),
  ADD COLUMN "pensionEmployerAmount" DECIMAL(10,2),
  ADD COLUMN "atpAmount"             DECIMAL(10,2),
  ADD COLUMN "bruttoDeductionAmount" DECIMAL(10,2),
  ADD COLUMN "otherDeductions"       JSONB,
  ADD COLUMN "deductionsSource"      TEXT;

-- #172 – deduction breakdown on MonthlyIncomeOverride
ALTER TABLE "MonthlyIncomeOverride"
  ADD COLUMN "amBidragAmount"        DECIMAL(10,2),
  ADD COLUMN "aSkattAmount"          DECIMAL(10,2),
  ADD COLUMN "pensionEmployeeAmount" DECIMAL(10,2),
  ADD COLUMN "pensionEmployerAmount" DECIMAL(10,2),
  ADD COLUMN "atpAmount"             DECIMAL(10,2),
  ADD COLUMN "bruttoDeductionAmount" DECIMAL(10,2),
  ADD COLUMN "otherDeductions"       JSONB,
  ADD COLUMN "deductionsSource"      TEXT;

-- #170 – TaxCardSettings model
CREATE TABLE "TaxCardSettings" (
  "id"                   TEXT NOT NULL,
  "jobId"                TEXT NOT NULL,
  "effectiveFrom"        TIMESTAMP(3) NOT NULL,
  "traekprocent"         DECIMAL(5,2) NOT NULL,
  "personfradragMonthly" DECIMAL(10,2) NOT NULL,
  "municipality"         TEXT,
  "pensionEmployeePct"   DECIMAL(5,2),
  "pensionEmployerPct"   DECIMAL(5,2),
  "atpAmount"            DECIMAL(10,2),
  "bruttoItems"          JSONB,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaxCardSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TaxCardSettings"
  ADD CONSTRAINT "TaxCardSettings_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TaxCardSettings_jobId_effectiveFrom_idx"
  ON "TaxCardSettings"("jobId", "effectiveFrom");
