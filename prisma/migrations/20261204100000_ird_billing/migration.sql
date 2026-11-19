-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "buyerPan" TEXT,
ADD COLUMN     "printCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "panNumber" TEXT;

-- AlterTable
ALTER TABLE "SupplierBill" ADD COLUMN     "vatAmount" INTEGER NOT NULL DEFAULT 0;

