-- CreateTable
CREATE TABLE "StampProgram" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampProgramItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "categoryId" TEXT,

    CONSTRAINT "StampProgramItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampRedemption" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "valueMinor" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StampProgram_businessId_id_key" ON "StampProgram"("businessId", "id");

-- CreateIndex
CREATE INDEX "StampProgramItem_businessId_programId_idx" ON "StampProgramItem"("businessId", "programId");

-- CreateIndex
CREATE INDEX "StampRedemption_businessId_customerId_programId_idx" ON "StampRedemption"("businessId", "customerId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "StampRedemption_businessId_invoiceId_programId_key" ON "StampRedemption"("businessId", "invoiceId", "programId");

-- AddForeignKey
ALTER TABLE "StampProgram" ADD CONSTRAINT "StampProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampProgramItem" ADD CONSTRAINT "StampProgramItem_businessId_programId_fkey" FOREIGN KEY ("businessId", "programId") REFERENCES "StampProgram"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampRedemption" ADD CONSTRAINT "StampRedemption_businessId_programId_fkey" FOREIGN KEY ("businessId", "programId") REFERENCES "StampProgram"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

