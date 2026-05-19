-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

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
    "householdId" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "ReceiptSubcategory_categoryId_householdId_name_key" ON "ReceiptSubcategory"("categoryId", "householdId", "name");

-- CreateIndex
CREATE INDEX "ReceiptSubcategory_categoryId_idx" ON "ReceiptSubcategory"("categoryId");

-- CreateIndex
CREATE INDEX "ReceiptSubcategory_householdId_idx" ON "ReceiptSubcategory"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptCategoryMapping_householdId_normalizedLabel_merchantKey_key" ON "ReceiptCategoryMapping"("householdId", "normalizedLabel", "merchantKey");

-- CreateIndex
CREATE INDEX "ReceiptCategoryMapping_householdId_categoryId_idx" ON "ReceiptCategoryMapping"("householdId", "categoryId");

-- CreateIndex
CREATE INDEX "ReceiptCategoryMapping_subcategoryId_idx" ON "ReceiptCategoryMapping"("subcategoryId");

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

-- Seed default receipt subcategories for system expense categories.
INSERT INTO "ReceiptSubcategory" ("id", "categoryId", "name", "isSystemWide", "createdAt", "updatedAt")
SELECT concat('rcptsub_', md5(c.id || s.name)), c.id, s.name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ExpenseCategory" c
JOIN (VALUES
  ('Food & Groceries', 'Food'),
  ('Food & Groceries', 'Alcohol'),
  ('Food & Groceries', 'Beer'),
  ('Food & Groceries', 'Wine'),
  ('Food & Groceries', 'Vegetables'),
  ('Food & Groceries', 'Meat'),
  ('Food & Groceries', 'Candy'),
  ('Food & Groceries', 'Toys'),
  ('Food & Groceries', 'Household goods'),
  ('Transport', 'Fuel'),
  ('Transport', 'Public transport'),
  ('Transport', 'Parking'),
  ('Transport', 'Taxi'),
  ('Subscriptions', 'Streaming'),
  ('Subscriptions', 'Software'),
  ('Subscriptions', 'Memberships'),
  ('Healthcare', 'Medicine'),
  ('Healthcare', 'Doctor'),
  ('Healthcare', 'Dental'),
  ('Utilities', 'Electricity'),
  ('Utilities', 'Water'),
  ('Utilities', 'Heating'),
  ('Utilities', 'Internet'),
  ('Other', 'Unsorted')
) AS s(category_name, name) ON s.category_name = c.name
WHERE c."isSystemWide" = true AND c."categoryType" = 'EXPENSE'
ON CONFLICT ("categoryId", "householdId", "name") DO NOTHING;
