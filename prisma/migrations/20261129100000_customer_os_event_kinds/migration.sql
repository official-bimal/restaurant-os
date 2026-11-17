-- Events sent to Customer OS now have a kind (a paid bill, a refund, a reward used, a reward released) and a reference that is
-- unique within the kind. Existing rows are all paid bills: their reference is their invoice id.

-- CreateEnum
CREATE TYPE "CustomerOsKind" AS ENUM ('PURCHASE', 'REFUND', 'REDEEM', 'RELEASE');

-- AlterTable
ALTER TABLE "CustomerOsEvent" ADD COLUMN "kind" "CustomerOsKind" NOT NULL DEFAULT 'PURCHASE',
ADD COLUMN "refId" TEXT;

UPDATE "CustomerOsEvent" SET "refId" = "invoiceId";

ALTER TABLE "CustomerOsEvent" ALTER COLUMN "refId" SET NOT NULL;

-- DropIndex
DROP INDEX "CustomerOsEvent_businessId_invoiceId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOsEvent_businessId_kind_refId_key" ON "CustomerOsEvent"("businessId", "kind", "refId");

-- CreateIndex
CREATE INDEX "CustomerOsEvent_businessId_invoiceId_idx" ON "CustomerOsEvent"("businessId", "invoiceId");
