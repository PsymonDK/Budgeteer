-- CreateTable
CREATE TABLE "ReminderActionToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "itemKey" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderActionToken_tokenHash_key" ON "ReminderActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ReminderActionToken_expiresAt_idx" ON "ReminderActionToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "ReminderActionToken" ADD CONSTRAINT "ReminderActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
