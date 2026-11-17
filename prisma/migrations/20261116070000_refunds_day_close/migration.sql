-- AlterEnum
ALTER TYPE "LoyaltyKind" ADD VALUE 'REVERSAL';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "creditNoteCounter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" TEXT;

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "loyaltyDiscount" INTEGER NOT NULL DEFAULT 0,
    "serviceCharge" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "roundOff" INTEGER NOT NULL,
    "grandTotal" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "RefundPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "expectedCash" INTEGER NOT NULL,
    "countedCash" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditNote_businessId_createdAt_idx" ON "CreditNote"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_businessId_id_key" ON "CreditNote"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_businessId_number_key" ON "CreditNote"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_businessId_invoiceId_key" ON "CreditNote"("businessId", "invoiceId");

-- CreateIndex
CREATE INDEX "RefundPayment_businessId_creditNoteId_idx" ON "RefundPayment"("businessId", "creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DayClose_businessId_date_key" ON "DayClose"("businessId", "date");

-- CreateIndex
CREATE INDEX "Invoice_businessId_createdAt_idx" ON "Invoice"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_businessId_invoiceId_fkey" FOREIGN KEY ("businessId", "invoiceId") REFERENCES "Invoice"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundPayment" ADD CONSTRAINT "RefundPayment_businessId_creditNoteId_fkey" FOREIGN KEY ("businessId", "creditNoteId") REFERENCES "CreditNote"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

