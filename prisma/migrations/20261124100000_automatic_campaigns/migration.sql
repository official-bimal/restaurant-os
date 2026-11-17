-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "autoKey" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "birthDay" INTEGER,
ADD COLUMN     "birthMonth" INTEGER;

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "template" TEXT NOT NULL,
    "offerPoints" INTEGER NOT NULL DEFAULT 0,
    "offerDays" INTEGER NOT NULL DEFAULT 14,
    "cooldownDays" INTEGER NOT NULL DEFAULT 60,
    "enabledById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_businessId_kind_key" ON "AutomationRule"("businessId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_businessId_autoKey_key" ON "Campaign"("businessId", "autoKey");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

