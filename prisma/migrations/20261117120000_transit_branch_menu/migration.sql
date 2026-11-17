-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BranchStock" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "receivedQuantity" INTEGER,
ADD COLUMN     "status" "TransferStatus" NOT NULL DEFAULT 'RECEIVED';

-- CreateTable
CREATE TABLE "BranchMenuItem" (
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "price" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchMenuItem_pkey" PRIMARY KEY ("branchId","menuItemId")
);

-- CreateIndex
CREATE INDEX "BranchMenuItem_businessId_menuItemId_idx" ON "BranchMenuItem"("businessId", "menuItemId");

-- CreateIndex
CREATE INDEX "StockTransfer_businessId_status_idx" ON "StockTransfer"("businessId", "status");

-- AddForeignKey
ALTER TABLE "BranchMenuItem" ADD CONSTRAINT "BranchMenuItem_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchMenuItem" ADD CONSTRAINT "BranchMenuItem_businessId_menuItemId_fkey" FOREIGN KEY ("businessId", "menuItemId") REFERENCES "MenuItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Transfers made before this existed were instant: they count as received in full, when they were made.
UPDATE "StockTransfer" SET "receivedQuantity" = "quantity", "receivedAt" = "createdAt" WHERE "status" = 'RECEIVED';
