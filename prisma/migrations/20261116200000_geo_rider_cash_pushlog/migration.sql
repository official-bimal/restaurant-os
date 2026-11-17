-- CreateEnum
CREATE TYPE "RiderEntryKind" AS ENUM ('CASH_HANDIN', 'PAYOUT');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "roadFactorPct" INTEGER NOT NULL DEFAULT 130;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "deliveryPay" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cashCollected" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "destLat" DOUBLE PRECISION,
ADD COLUMN     "destLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RiderEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "riderUserId" TEXT NOT NULL,
    "kind" "RiderEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushLog" (
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushLog_pkey" PRIMARY KEY ("businessId","key")
);

-- CreateIndex
CREATE INDEX "RiderEntry_businessId_riderUserId_createdAt_idx" ON "RiderEntry"("businessId", "riderUserId", "createdAt");

