-- CreateEnum
CREATE TYPE "SupplierPayMethod" AS ENUM ('CASH', 'BANK', 'QR', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('NONE', 'HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TimeSource" AS ENUM ('CLOCK', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayAdjustKind" AS ENUM ('ALLOWANCE', 'BONUS', 'ADVANCE', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PLANNED', 'OUT', 'DONE');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "BranchMenuItem" ADD COLUMN     "stationId" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "overtimeAfterMinutes" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN     "overtimeBps" INTEGER NOT NULL DEFAULT 15000,
ADD COLUMN     "payRate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payType" "PayType" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "batchStop" INTEGER;

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT,
    "billDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "purchaseOrderId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "SupplierPayMethod" NOT NULL,
    "paidOn" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "source" "TimeSource" NOT NULL DEFAULT 'CLOCK',
    "note" TEXT,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" "PayAdjustKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "note" TEXT,
    "finalizedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "rate" INTEGER NOT NULL,
    "regularMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "basePay" INTEGER NOT NULL DEFAULT 0,
    "overtimePay" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "netPay" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidMethod" TEXT,
    "paidById" TEXT,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchCategoryHide" (
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "BranchCategoryHide_pkey" PRIMARY KEY ("branchId","categoryId")
);

-- CreateTable
CREATE TABLE "BranchAddOn" (
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "price" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchAddOn_pkey" PRIMARY KEY ("branchId","addOnId")
);

-- CreateTable
CREATE TABLE "DeliveryBatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "riderUserId" TEXT,
    "riderName" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedMeters" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPlace" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "status" "SendStatus" NOT NULL,
    "providerRef" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBill_businessId_supplierId_idx" ON "SupplierBill"("businessId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierBill_businessId_dueDate_idx" ON "SupplierBill"("businessId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_businessId_id_key" ON "SupplierBill"("businessId", "id");

-- CreateIndex
CREATE INDEX "SupplierPayment_businessId_billId_idx" ON "SupplierPayment"("businessId", "billId");

-- CreateIndex
CREATE INDEX "TimeEntry_businessId_userId_clockIn_idx" ON "TimeEntry"("businessId", "userId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_businessId_branchId_clockIn_idx" ON "TimeEntry"("businessId", "branchId", "clockIn");

-- CreateIndex
CREATE INDEX "PayAdjustment_businessId_period_userId_idx" ON "PayAdjustment"("businessId", "period", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_businessId_id_key" ON "PayrollRun"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_businessId_periodStart_periodEnd_key" ON "PayrollRun"("businessId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PayrollLine_businessId_userId_idx" ON "PayrollLine"("businessId", "userId");

-- CreateIndex
CREATE INDEX "DeliveryBatch_businessId_branchId_status_idx" ON "DeliveryBatch"("businessId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPlace_businessId_phoneKey_key" ON "DeliveryPlace"("businessId", "phoneKey");

-- CreateIndex
CREATE INDEX "MessageLog_businessId_campaignId_idx" ON "MessageLog"("businessId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_campaignId_customerId_key" ON "MessageLog"("campaignId", "customerId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DeliveryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchMenuItem" ADD CONSTRAINT "BranchMenuItem_businessId_stationId_fkey" FOREIGN KEY ("businessId", "stationId") REFERENCES "Station"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_businessId_supplierId_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_businessId_billId_fkey" FOREIGN KEY ("businessId", "billId") REFERENCES "SupplierBill"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_businessId_runId_fkey" FOREIGN KEY ("businessId", "runId") REFERENCES "PayrollRun"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCategoryHide" ADD CONSTRAINT "BranchCategoryHide_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCategoryHide" ADD CONSTRAINT "BranchCategoryHide_businessId_categoryId_fkey" FOREIGN KEY ("businessId", "categoryId") REFERENCES "MenuCategory"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchAddOn" ADD CONSTRAINT "BranchAddOn_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchAddOn" ADD CONSTRAINT "BranchAddOn_businessId_addOnId_fkey" FOREIGN KEY ("businessId", "addOnId") REFERENCES "AddOn"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryBatch" ADD CONSTRAINT "DeliveryBatch_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

