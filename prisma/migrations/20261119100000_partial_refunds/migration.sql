-- DropIndex
DROP INDEX "CreditNote_businessId_invoiceId_key";

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "partial" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CreditNote_businessId_invoiceId_idx" ON "CreditNote"("businessId", "invoiceId");

