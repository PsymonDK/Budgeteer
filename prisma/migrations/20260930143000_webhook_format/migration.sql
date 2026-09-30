-- CreateEnum
CREATE TYPE "WebhookFormat" AS ENUM ('NTFY', 'JSON');

-- AlterTable
ALTER TABLE "HouseholdNotificationSettings" ADD COLUMN     "webhookFormat" "WebhookFormat" NOT NULL DEFAULT 'NTFY',
ADD COLUMN     "webhookSecretEncrypted" TEXT;

-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN     "reminderWebhookFormat" "WebhookFormat" NOT NULL DEFAULT 'NTFY',
ADD COLUMN     "reminderWebhookSecretEncrypted" TEXT;
