-- AlterTable
ALTER TABLE "PrintSetting" ADD COLUMN "slipFields" JSONB;

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN "printerId" TEXT,
ADD COLUMN "stationKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paperWidthMm" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintRoute" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stationKey" TEXT NOT NULL DEFAULT '',
    "printerId" TEXT NOT NULL,

    CONSTRAINT "PrintRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Printer_businessId_branchId_idx" ON "Printer"("businessId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_businessId_id_key" ON "Printer"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_branchId_name_key" ON "Printer"("branchId", "name");

-- CreateIndex
CREATE INDEX "PrintRoute_businessId_branchId_idx" ON "PrintRoute"("businessId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintRoute_branchId_kind_stationKey_key" ON "PrintRoute"("branchId", "kind", "stationKey");

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
