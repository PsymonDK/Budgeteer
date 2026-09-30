-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN     "reminderDigestTime" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "reminderEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderEmailAddress" TEXT,
ADD COLUMN     "reminderInApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderLeadDays" INTEGER,
ADD COLUMN     "reminderWebhook" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderWebhookUrl" TEXT;

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookAllowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdNotificationSettings" (
    "householdId" TEXT NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrl" TEXT,
    "leadDays" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdNotificationSettings_pkey" PRIMARY KEY ("householdId")
);

-- AddForeignKey
ALTER TABLE "HouseholdNotificationSettings" ADD CONSTRAINT "HouseholdNotificationSettings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
