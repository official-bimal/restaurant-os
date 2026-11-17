-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('PURCHASE', 'SALE', 'WASTE', 'COUNT');

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "costMilli" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostMilli" INTEGER NOT NULL DEFAULT 0,
    "totalCost" INTEGER NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "supplier" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_businessId_id_key" ON "StockItem"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_businessId_name_key" ON "StockItem"("businessId", "name");

-- CreateIndex
CREATE INDEX "RecipeLine_businessId_menuItemId_idx" ON "RecipeLine"("businessId", "menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_menuItemId_stockItemId_key" ON "RecipeLine"("menuItemId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_stockItemId_createdAt_idx" ON "StockMovement"("businessId", "stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_kind_createdAt_idx" ON "StockMovement"("businessId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_businessId_menuItemId_fkey" FOREIGN KEY ("businessId", "menuItemId") REFERENCES "MenuItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_businessId_stockItemId_fkey" FOREIGN KEY ("businessId", "stockItemId") REFERENCES "StockItem"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_stockItemId_fkey" FOREIGN KEY ("businessId", "stockItemId") REFERENCES "StockItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

