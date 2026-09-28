-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
