-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "fiscalYear" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "voucher" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "sourceKind" TEXT,
    "sourceId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "narration" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_businessId_id_key" ON "Account"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_businessId_code_key" ON "Account"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_businessId_key_key" ON "Account"("businessId", "key");

-- CreateIndex
CREATE INDEX "JournalEntry_businessId_date_idx" ON "JournalEntry"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_id_key" ON "JournalEntry"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_fiscalYear_number_key" ON "JournalEntry"("businessId", "fiscalYear", "number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_sourceKind_sourceId_key" ON "JournalEntry"("businessId", "sourceKind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_reversesId_key" ON "JournalEntry"("businessId", "reversesId");

-- CreateIndex
CREATE INDEX "JournalLine_businessId_entryId_idx" ON "JournalLine"("businessId", "entryId");

-- CreateIndex
CREATE INDEX "JournalLine_businessId_accountId_idx" ON "JournalLine"("businessId", "accountId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_businessId_entryId_fkey" FOREIGN KEY ("businessId", "entryId") REFERENCES "JournalEntry"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_businessId_accountId_fkey" FOREIGN KEY ("businessId", "accountId") REFERENCES "Account"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

