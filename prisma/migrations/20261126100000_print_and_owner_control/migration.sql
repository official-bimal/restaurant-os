-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "printedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PrintSetting" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "paperWidthMm" INTEGER NOT NULL DEFAULT 80,
    "paperHeightMm" INTEGER,
    "marginMm" INTEGER NOT NULL DEFAULT 4,
    "fontSizeTenthPt" INTEGER NOT NULL DEFAULT 90,
    "headerLine" TEXT,
    "footerLine" TEXT NOT NULL DEFAULT 'Thank you!',
    "showPan" BOOLEAN NOT NULL DEFAULT true,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showCustomer" BOOLEAN NOT NULL DEFAULT true,
    "kitchenLargeText" BOOLEAN NOT NULL DEFAULT true,
    "autoKitchenPrint" BOOLEAN NOT NULL DEFAULT false,
    "receiptCopies" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "creditNoteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSetting" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "summaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "summaryHour" INTEGER NOT NULL DEFAULT 22,
    "channelPush" BOOLEAN NOT NULL DEFAULT true,
    "smsPhone" TEXT,
    "email" TEXT,
    "lastSummaryDate" TEXT,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "alertVoidCount" INTEGER NOT NULL DEFAULT 3,
    "alertVoidAmount" INTEGER NOT NULL DEFAULT 500000,
    "alertDiscountPct" INTEGER NOT NULL DEFAULT 20,
    "alertDiscountShareBps" INTEGER NOT NULL DEFAULT 1000,
    "alertRefundAmount" INTEGER NOT NULL DEFAULT 500000,
    "alertCashDiff" INTEGER NOT NULL DEFAULT 10000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerAlert" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'warn',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "OwnerAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintSetting_businessId_key" ON "PrintSetting"("businessId");

-- CreateIndex
CREATE INDEX "PrintJob_businessId_branchId_status_createdAt_idx" ON "PrintJob"("businessId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSetting_businessId_key" ON "OwnerSetting"("businessId");

-- CreateIndex
CREATE INDEX "OwnerAlert_businessId_createdAt_idx" ON "OwnerAlert"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAlert_businessId_kind_date_key_key" ON "OwnerAlert"("businessId", "kind", "date", "key");

-- AddForeignKey
ALTER TABLE "PrintSetting" ADD CONSTRAINT "PrintSetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerSetting" ADD CONSTRAINT "OwnerSetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAlert" ADD CONSTRAINT "OwnerAlert_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

