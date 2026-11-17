-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

