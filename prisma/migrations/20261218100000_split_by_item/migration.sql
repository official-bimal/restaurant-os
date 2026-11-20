-- AlterTable
ALTER TABLE "Order" ADD COLUMN "label" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "shareDen" INTEGER NOT NULL DEFAULT 1;
