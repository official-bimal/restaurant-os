-- AlterTable
ALTER TABLE "Business" ADD COLUMN "brandAccent" TEXT;

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "themeMode" TEXT NOT NULL DEFAULT 'SYSTEM',
    "accent" TEXT,
    "dashboardTemplate" TEXT NOT NULL DEFAULT 'CLASSIC',
    "dashboardLayout" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId","businessId")
);

-- CreateIndex
CREATE INDEX "UserPreference_businessId_idx" ON "UserPreference"("businessId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
