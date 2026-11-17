-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "offlineDeviceId" TEXT,
ADD COLUMN     "offlineKey" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OfflineNumberBlock" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNumber" INTEGER NOT NULL,
    "toNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "OfflineNumberBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceGap" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "blockId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfflineNumberBlock_businessId_status_idx" ON "OfflineNumberBlock"("businessId", "status");

-- CreateIndex
CREATE INDEX "OfflineNumberBlock_businessId_deviceId_idx" ON "OfflineNumberBlock"("businessId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceGap_businessId_number_key" ON "InvoiceGap"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_businessId_offlineKey_key" ON "Invoice"("businessId", "offlineKey");

-- AddForeignKey
ALTER TABLE "OfflineNumberBlock" ADD CONSTRAINT "OfflineNumberBlock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceGap" ADD CONSTRAINT "InvoiceGap_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

