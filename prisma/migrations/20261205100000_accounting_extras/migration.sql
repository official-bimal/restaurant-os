-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "reconciledOn" TEXT;

-- AlterTable
ALTER TABLE "SupplierBill" ADD COLUMN     "tdsAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "purchaseDate" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "disposedOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetDepreciation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_businessId_id_key" ON "FixedAsset"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetDepreciation_businessId_assetId_fiscalYear_key" ON "FixedAssetDepreciation"("businessId", "assetId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_businessId_fiscalYear_accountId_key" ON "Budget"("businessId", "fiscalYear", "accountId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAssetDepreciation" ADD CONSTRAINT "FixedAssetDepreciation_businessId_assetId_fkey" FOREIGN KEY ("businessId", "assetId") REFERENCES "FixedAsset"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

