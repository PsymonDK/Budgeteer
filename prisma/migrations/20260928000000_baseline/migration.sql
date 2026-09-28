-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'BOOKKEEPER', 'USER');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('FUTURE', 'ACTIVE', 'RETIRED', 'SIMULATION');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "BudgetMode" AS ENUM ('ONE_OFF', 'SPREAD_ANNUALLY');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('EXPENSE', 'SAVINGS');

-- CreateEnum
CREATE TYPE "ExpenseOwnership" AS ENUM ('SHARED', 'INDIVIDUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SavingsOwnership" AS ENUM ('SHARED', 'INDIVIDUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'CREDIT_CARD', 'MOBILE_PAY');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SUCCESS', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PAID', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "BudgetModelType" AS ENUM ('AVERAGE', 'FORWARD_LOOKING', 'PAY_NO_PAY');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('PENDING', 'PAID', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReceiptClassifierTermType" AS ENUM ('NOISE_TOKEN', 'LOW_VALUE_WORD', 'OCR_ALIAS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "isProxy" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultHouseholdId" TEXT,
    "preferredCurrency" TEXT NOT NULL DEFAULT 'DKK',
    "notifyOverAllocation" BOOLEAN NOT NULL DEFAULT true,
    "notifyExpensesExceedIncome" BOOLEAN NOT NULL DEFAULT true,
    "notifyNoSavings" BOOLEAN NOT NULL DEFAULT true,
    "notifyUncategorised" BOOLEAN NOT NULL DEFAULT true,
    "showDashboardSparklines" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoMarkTransferPaid" BOOLEAN NOT NULL DEFAULT false,
    "budgetModel" "BudgetModelType" NOT NULL DEFAULT 'AVERAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetYear" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'FUTURE',
    "simulationName" TEXT,
    "copiedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employer" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DK',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT,
    "rateUsed" DECIMAL(18,6),
    "payslipLines" JSONB,
    "pensionEmployerMonthly" DECIMAL(10,2),
    "deductionsSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyIncomeOverride" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "payslipLines" JSONB,
    "pensionEmployerMonthly" DECIMAL(10,2),
    "deductionsSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyIncomeOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "includeInBudget" BOOLEAN NOT NULL,
    "budgetMode" "BudgetMode",
    "currencyCode" TEXT,
    "rateUsed" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdIncomeAllocation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "allocationPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "HouseholdIncomeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCardSettings" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "traekprocent" DECIMAL(5,2) NOT NULL,
    "personfradragMonthly" DECIMAL(10,2) NOT NULL,
    "municipality" TEXT,
    "pensionEmployeePct" DECIMAL(5,2),
    "pensionEmployerPct" DECIMAL(5,2),
    "atpAmount" DECIMAL(10,2),
    "bruttoItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "categoryType" "CategoryType" NOT NULL DEFAULT 'EXPENSE',
    "isSystemWide" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "householdId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "accountId" TEXT,
    "merchantName" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(10,2),
    "taxAmount" DECIMAL(10,2),
    "feeAmount" DECIMAL(10,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'DKK',
    "sourceMimeType" TEXT,
    "sourceFileName" TEXT,
    "sourceStoragePath" TEXT,
    "sourceFileSize" INTEGER,
    "rawText" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "confidence" "ReceiptConfidence" NOT NULL DEFAULT 'LOW',
    "notes" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLineItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "originalText" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "quantity" DECIMAL(10,3),
    "amount" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT,
    "confidence" "ReceiptConfidence" NOT NULL DEFAULT 'LOW',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSubcategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "householdId" TEXT,
    "name" TEXT NOT NULL,
    "isSystemWide" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSubcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptCategoryMapping" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT 'system',
    "householdId" TEXT,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "normalizedLabel" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL DEFAULT '',
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptClassifierTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "frequencyPeriod" TEXT,
    "startMonth" INTEGER,
    "endMonth" INTEGER,
    "monthlyEquivalent" DECIMAL(10,2) NOT NULL,
    "forwardMonthlyEquivalent" DECIMAL(10,2),
    "notes" TEXT,
    "currencyCode" TEXT,
    "originalAmount" DECIMAL(10,2),
    "rateUsed" DECIMAL(18,6),
    "rateDate" TIMESTAMP(3),
    "ownership" "ExpenseOwnership" NOT NULL DEFAULT 'SHARED',
    "ownedByUserId" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCustomSplit" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "ExpenseCustomSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsEntry" (
    "id" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "frequencyPeriod" TEXT,
    "monthlyEquivalent" DECIMAL(10,2) NOT NULL,
    "forwardMonthlyEquivalent" DECIMAL(10,2),
    "notes" TEXT,
    "currencyCode" TEXT,
    "originalAmount" DECIMAL(10,2),
    "rateUsed" DECIMAL(18,6),
    "rateDate" TIMESTAMP(3),
    "ownership" "SavingsOwnership" NOT NULL DEFAULT 'SHARED',
    "ownedByUserId" TEXT,
    "accountId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsCustomSplit" (
    "id" TEXT NOT NULL,
    "savingsEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "SavingsCustomSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "fetchedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "AutomationRunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "triggeredBy" "AutomationTrigger" NOT NULL,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "message" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTransfer" (
    "id" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "calculatedAmount" DECIMAL(10,2) NOT NULL,
    "actualAmount" DECIMAL(10,2),
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "automationRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseOccurrence" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "scheduledAmount" DECIMAL(10,2) NOT NULL,
    "carriedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "actualAmount" DECIMAL(10,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsOccurrence" (
    "id" TEXT NOT NULL,
    "savingsEntryId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "scheduledAmount" DECIMAL(10,2) NOT NULL,
    "carriedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "actualAmount" DECIMAL(10,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE INDEX "SalaryRecord_jobId_effectiveFrom_idx" ON "SalaryRecord"("jobId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyIncomeOverride_jobId_year_month_key" ON "MonthlyIncomeOverride"("jobId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdIncomeAllocation_jobId_budgetYearId_key" ON "HouseholdIncomeAllocation"("jobId", "budgetYearId");

-- CreateIndex
CREATE INDEX "TaxCardSettings_jobId_effectiveFrom_idx" ON "TaxCardSettings"("jobId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Receipt_householdId_purchaseDate_idx" ON "Receipt"("householdId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Receipt_householdId_status_idx" ON "Receipt"("householdId", "status");

-- CreateIndex
CREATE INDEX "ReceiptLineItem_receiptId_idx" ON "ReceiptLineItem"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptLineItem_categoryId_idx" ON "ReceiptLineItem"("categoryId");

-- CreateIndex
CREATE INDEX "ReceiptLineItem_subcategoryId_idx" ON "ReceiptLineItem"("subcategoryId");

-- CreateIndex
CREATE INDEX "ReceiptLineItem_normalizedLabel_idx" ON "ReceiptLineItem"("normalizedLabel");

-- CreateIndex
CREATE INDEX "ReceiptSubcategory_categoryId_idx" ON "ReceiptSubcategory"("categoryId");

-- CreateIndex
CREATE INDEX "ReceiptSubcategory_householdId_idx" ON "ReceiptSubcategory"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSubcategory_categoryId_householdId_name_key" ON "ReceiptSubcategory"("categoryId", "householdId", "name");

-- CreateIndex
CREATE INDEX "ReceiptCategoryMapping_householdId_categoryId_idx" ON "ReceiptCategoryMapping"("householdId", "categoryId");

-- CreateIndex
CREATE INDEX "ReceiptCategoryMapping_scopeKey_categoryId_idx" ON "ReceiptCategoryMapping"("scopeKey", "categoryId");

-- CreateIndex
CREATE INDEX "ReceiptCategoryMapping_subcategoryId_idx" ON "ReceiptCategoryMapping"("subcategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptCategoryMapping_scopeKey_normalizedLabel_merchantKey_key" ON "ReceiptCategoryMapping"("scopeKey", "normalizedLabel", "merchantKey");

-- CreateIndex
CREATE INDEX "ReceiptClassifierTerm_householdId_idx" ON "ReceiptClassifierTerm"("householdId");

-- CreateIndex
CREATE INDEX "ReceiptClassifierTerm_termType_isActive_idx" ON "ReceiptClassifierTerm"("termType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptClassifierTerm_scopeKey_termType_term_key" ON "ReceiptClassifierTerm"("scopeKey", "termType", "term");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCustomSplit_expenseId_userId_key" ON "ExpenseCustomSplit"("expenseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsCustomSplit_savingsEntryId_userId_key" ON "SavingsCustomSplit"("savingsEntryId", "userId");

-- CreateIndex
CREATE INDEX "CurrencyRate_currencyCode_fetchedDate_idx" ON "CurrencyRate"("currencyCode", "fetchedDate");

-- CreateIndex
CREATE INDEX "CurrencyRate_baseCurrency_currencyCode_idx" ON "CurrencyRate"("baseCurrency", "currencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Automation_householdId_key_key" ON "Automation"("householdId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTransfer_budgetYearId_month_year_key" ON "BudgetTransfer"("budgetYearId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseOccurrence_expenseId_year_month_key" ON "ExpenseOccurrence"("expenseId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsOccurrence_savingsEntryId_year_month_key" ON "SavingsOccurrence"("savingsEntryId", "year", "month");

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetYear" ADD CONSTRAINT "BudgetYear_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetYear" ADD CONSTRAINT "BudgetYear_copiedFromId_fkey" FOREIGN KEY ("copiedFromId") REFERENCES "BudgetYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRecord" ADD CONSTRAINT "SalaryRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyIncomeOverride" ADD CONSTRAINT "MonthlyIncomeOverride_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdIncomeAllocation" ADD CONSTRAINT "HouseholdIncomeAllocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdIncomeAllocation" ADD CONSTRAINT "HouseholdIncomeAllocation_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "BudgetYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCardSettings" ADD CONSTRAINT "TaxCardSettings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownedByUserId_fkey" FOREIGN KEY ("ownedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLineItem" ADD CONSTRAINT "ReceiptLineItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLineItem" ADD CONSTRAINT "ReceiptLineItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLineItem" ADD CONSTRAINT "ReceiptLineItem_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ReceiptSubcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSubcategory" ADD CONSTRAINT "ReceiptSubcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSubcategory" ADD CONSTRAINT "ReceiptSubcategory_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCategoryMapping" ADD CONSTRAINT "ReceiptCategoryMapping_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCategoryMapping" ADD CONSTRAINT "ReceiptCategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCategoryMapping" ADD CONSTRAINT "ReceiptCategoryMapping_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ReceiptSubcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptClassifierTerm" ADD CONSTRAINT "ReceiptClassifierTerm_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "BudgetYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_ownedByUserId_fkey" FOREIGN KEY ("ownedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCustomSplit" ADD CONSTRAINT "ExpenseCustomSplit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCustomSplit" ADD CONSTRAINT "ExpenseCustomSplit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "BudgetYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_ownedByUserId_fkey" FOREIGN KEY ("ownedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsCustomSplit" ADD CONSTRAINT "SavingsCustomSplit_savingsEntryId_fkey" FOREIGN KEY ("savingsEntryId") REFERENCES "SavingsEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsCustomSplit" ADD CONSTRAINT "SavingsCustomSplit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "BudgetYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseOccurrence" ADD CONSTRAINT "ExpenseOccurrence_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsOccurrence" ADD CONSTRAINT "SavingsOccurrence_savingsEntryId_fkey" FOREIGN KEY ("savingsEntryId") REFERENCES "SavingsEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

