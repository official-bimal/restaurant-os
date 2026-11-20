-- CreateTable
CREATE TABLE "DisplaySetting" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeTitle" TEXT,
    "welcomeText" TEXT,
    "thanksText" TEXT,
    "thanksSeconds" INTEGER NOT NULL DEFAULT 12,
    "showNotes" BOOLEAN NOT NULL DEFAULT true,
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "autoQr" BOOLEAN NOT NULL DEFAULT false,
    "qrLabel" TEXT,
    "qrContentType" TEXT,
    "qrBytes" INTEGER,
    "qrData" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisplaySetting_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "CustomerDisplay" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "orderId" TEXT,
    "options" JSONB,
    "showQr" BOOLEAN NOT NULL DEFAULT false,
    "followedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDisplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDisplay_token_key" ON "CustomerDisplay"("token");

-- CreateIndex
CREATE INDEX "CustomerDisplay_businessId_branchId_idx" ON "CustomerDisplay"("businessId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDisplay_branchId_name_key" ON "CustomerDisplay"("branchId", "name");

-- AddForeignKey
ALTER TABLE "DisplaySetting" ADD CONSTRAINT "DisplaySetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDisplay" ADD CONSTRAINT "CustomerDisplay_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDisplay" ADD CONSTRAINT "CustomerDisplay_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
