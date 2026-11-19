-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DealKind" AS ENUM ('PERCENT_OFF', 'COMBO');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "reservationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dealDiscount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dealName" TEXT;

-- CreateTable
CREATE TABLE "HukkaSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "coils" INTEGER NOT NULL DEFAULT 0,
    "alertMinutes" INTEGER NOT NULL DEFAULT 60,
    "startedById" TEXT,

    CONSTRAINT "HukkaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "tableId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "token" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "DealKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "days" TEXT NOT NULL DEFAULT '',
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "comboPrice" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "categoryId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DealItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HukkaSession_businessId_branchId_endedAt_idx" ON "HukkaSession"("businessId", "branchId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HukkaSession_businessId_orderItemId_key" ON "HukkaSession"("businessId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_token_key" ON "Reservation"("token");

-- CreateIndex
CREATE INDEX "Reservation_businessId_branchId_date_idx" ON "Reservation"("businessId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_businessId_id_key" ON "Deal"("businessId", "id");

-- CreateIndex
CREATE INDEX "DealItem_businessId_dealId_idx" ON "DealItem"("businessId", "dealId");

-- AddForeignKey
ALTER TABLE "HukkaSession" ADD CONSTRAINT "HukkaSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HukkaSession" ADD CONSTRAINT "HukkaSession_businessId_orderId_fkey" FOREIGN KEY ("businessId", "orderId") REFERENCES "Order"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealItem" ADD CONSTRAINT "DealItem_businessId_dealId_fkey" FOREIGN KEY ("businessId", "dealId") REFERENCES "Deal"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

