-- Stock by branch. Hand-ordered so the existing quantities are carried over before the old columns go.
-- Existing stock, stock history and purchase orders are assigned to each business's FIRST branch (by creation).
-- Every other branch starts with zero of every item, the same reorder level and the same average cost.

-- AlterEnum (two separate statements; the new values are not used inside this migration)
ALTER TYPE "StockMovementKind" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementKind" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "BranchStock" (
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "costMilli" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("branchId","stockItemId")
);

-- Carry over: one row per item per branch; only the first branch gets the quantity.
INSERT INTO "BranchStock" ("businessId", "branchId", "stockItemId", "quantity", "reorderLevel", "costMilli")
SELECT s."businessId", b."id", s."id",
       CASE WHEN b."id" = (SELECT f."id" FROM "Branch" f WHERE f."businessId" = s."businessId" ORDER BY f."createdAt", f."id" LIMIT 1)
            THEN s."quantity" ELSE 0 END,
       s."reorderLevel", s."costMilli"
FROM "StockItem" s
JOIN "Branch" b ON b."businessId" = s."businessId";

-- Movements and purchase orders belong to a branch: the first branch for everything that already exists.
ALTER TABLE "StockMovement" ADD COLUMN "branchId" TEXT;
UPDATE "StockMovement" m SET "branchId" = (
  SELECT f."id" FROM "Branch" f WHERE f."businessId" = m."businessId" ORDER BY f."createdAt", f."id" LIMIT 1
);
ALTER TABLE "StockMovement" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "PurchaseOrder" ADD COLUMN "branchId" TEXT;
UPDATE "PurchaseOrder" p SET "branchId" = (
  SELECT f."id" FROM "Branch" f WHERE f."businessId" = p."businessId" ORDER BY f."createdAt", f."id" LIMIT 1
);
ALTER TABLE "PurchaseOrder" ALTER COLUMN "branchId" SET NOT NULL;

-- The shared item keeps only its name and unit.
ALTER TABLE "StockItem" DROP COLUMN "costMilli",
DROP COLUMN "quantity",
DROP COLUMN "reorderLevel";

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostMilli" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchStock_businessId_stockItemId_idx" ON "BranchStock"("businessId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockTransfer_businessId_createdAt_idx" ON "StockTransfer"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_businessId_fromBranchId_createdAt_idx" ON "StockTransfer"("businessId", "fromBranchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_businessId_toBranchId_createdAt_idx" ON "StockTransfer"("businessId", "toBranchId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_businessId_branchId_status_idx" ON "PurchaseOrder"("businessId", "branchId", "status");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_branchId_createdAt_idx" ON "StockMovement"("businessId", "branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_businessId_stockItemId_fkey" FOREIGN KEY ("businessId", "stockItemId") REFERENCES "StockItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_fromBranchId_fkey" FOREIGN KEY ("businessId", "fromBranchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_toBranchId_fkey" FOREIGN KEY ("businessId", "toBranchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_stockItemId_fkey" FOREIGN KEY ("businessId", "stockItemId") REFERENCES "StockItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
