-- AlterTable
ALTER TABLE "DiningTable" ADD COLUMN     "posX" INTEGER,
ADD COLUMN     "posY" INTEGER;

-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN     "packQuantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "leadDays" INTEGER NOT NULL DEFAULT 2;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_businessId_supplierId_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

