-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'MERGED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "splitFromId" TEXT;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "closeReason" TEXT;

