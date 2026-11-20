-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "countId" TEXT,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "seatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemsCounted" INTEGER NOT NULL,
    "itemsChanged" INTEGER NOT NULL,
    "valueChange" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_businessId_branchId_createdAt_idx" ON "StockCount"("businessId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_countId_idx" ON "StockMovement"("businessId", "countId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
