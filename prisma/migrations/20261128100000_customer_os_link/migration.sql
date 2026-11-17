-- CreateEnum
CREATE TYPE "CustomerOsStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CustomerOsLink" (
    "businessId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOsLink_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "CustomerOsEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "CustomerOsStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "pointsEarned" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CustomerOsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOsEvent_status_nextAttemptAt_idx" ON "CustomerOsEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CustomerOsEvent_businessId_status_idx" ON "CustomerOsEvent"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOsEvent_businessId_invoiceId_key" ON "CustomerOsEvent"("businessId", "invoiceId");

-- AddForeignKey
ALTER TABLE "CustomerOsLink" ADD CONSTRAINT "CustomerOsLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOsEvent" ADD CONSTRAINT "CustomerOsEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

