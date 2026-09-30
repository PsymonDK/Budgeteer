-- CreateEnum
CREATE TYPE "SmtpSecurity" AS ENUM ('NONE', 'STARTTLS', 'TLS');

-- AlterTable
ALTER TABLE "NotificationSettings" ADD COLUMN     "smtpFromAddress" TEXT,
ADD COLUMN     "smtpFromName" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEncrypted" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecurity" "SmtpSecurity" NOT NULL DEFAULT 'STARTTLS',
ADD COLUMN     "smtpUsername" TEXT;
