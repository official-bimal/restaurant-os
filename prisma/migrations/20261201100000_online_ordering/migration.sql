-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "onlineDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlineEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onlineMinOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onlineNotice" TEXT,
ADD COLUMN     "onlinePickup" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePrepMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "onlineToken" TEXT;

-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'PENDING',
    "type" "OrderType" NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "note" TEXT,
    "subtotal" INTEGER NOT NULL,
    "address" TEXT,
    "location" TEXT,
    "destLat" DOUBLE PRECISION,
    "destLng" DOUBLE PRECISION,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "deliveryZoneId" TEXT,
    "deliveryZoneName" TEXT,
    "deliveryMeters" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "rejectReason" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrderItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "addOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "OnlineOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_trackingToken_key" ON "OnlineOrder"("trackingToken");

-- CreateIndex
CREATE INDEX "OnlineOrder_businessId_branchId_status_idx" ON "OnlineOrder"("businessId", "branchId", "status");

-- CreateIndex
CREATE INDEX "OnlineOrder_businessId_customerPhone_status_idx" ON "OnlineOrder"("businessId", "customerPhone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_businessId_id_key" ON "OnlineOrder"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_businessId_idempotencyKey_key" ON "OnlineOrder"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OnlineOrderItem_businessId_onlineOrderId_idx" ON "OnlineOrderItem"("businessId", "onlineOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_onlineToken_key" ON "Branch"("onlineToken");

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderItem" ADD CONSTRAINT "OnlineOrderItem_businessId_onlineOrderId_fkey" FOREIGN KEY ("businessId", "onlineOrderId") REFERENCES "OnlineOrder"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

