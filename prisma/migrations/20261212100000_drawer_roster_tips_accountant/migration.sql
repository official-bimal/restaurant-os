-- CreateEnum
CREATE TYPE "DrawerMoveKind" AS ENUM ('BANK_DEPOSIT', 'PETTY_EXPENSE', 'OWNER_TAKES', 'OWNER_ADDS', 'OTHER_IN', 'OTHER_OUT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "openKey" TEXT,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloat" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "countedCash" INTEGER,
    "expectedCash" INTEGER,
    "difference" INTEGER,
    "note" TEXT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "DrawerMoveKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterShift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payoutId" TEXT,

    CONSTRAINT "TipEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPayout" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "pooled" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPayoutLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "adjustmentId" TEXT,

    CONSTRAINT "TipPayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashShift_businessId_branchId_openedAt_idx" ON "CashShift"("businessId", "branchId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_businessId_id_key" ON "CashShift"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_businessId_openKey_key" ON "CashShift"("businessId", "openKey");

-- CreateIndex
CREATE INDEX "CashMovement_businessId_shiftId_idx" ON "CashMovement"("businessId", "shiftId");

-- CreateIndex
CREATE INDEX "RosterShift_businessId_branchId_date_idx" ON "RosterShift"("businessId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RosterShift_businessId_userId_date_startTime_key" ON "RosterShift"("businessId", "userId", "date", "startTime");

-- CreateIndex
CREATE INDEX "TipEntry_businessId_branchId_date_idx" ON "TipEntry"("businessId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TipPayout_businessId_id_key" ON "TipPayout"("businessId", "id");

-- CreateIndex
CREATE INDEX "TipPayoutLine_businessId_payoutId_idx" ON "TipPayoutLine"("businessId", "payoutId");

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_businessId_shiftId_fkey" FOREIGN KEY ("businessId", "shiftId") REFERENCES "CashShift"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipEntry" ADD CONSTRAINT "TipEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPayout" ADD CONSTRAINT "TipPayout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPayoutLine" ADD CONSTRAINT "TipPayoutLine_businessId_payoutId_fkey" FOREIGN KEY ("businessId", "payoutId") REFERENCES "TipPayout"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

