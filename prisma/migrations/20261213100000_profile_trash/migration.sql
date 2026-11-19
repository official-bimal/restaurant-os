-- AlterTable
ALTER TABLE "Business" ADD COLUMN "legalName" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "businessType" TEXT,
ADD COLUMN "openedOn" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "facebook" TEXT,
ADD COLUMN "instagram" TEXT;

-- CreateTable
CREATE TABLE "BusinessLogo" (
    "businessId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLogo_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deletedById" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrashItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrashItem_businessId_deletedAt_idx" ON "TrashItem"("businessId", "deletedAt");

-- AddForeignKey
ALTER TABLE "BusinessLogo" ADD CONSTRAINT "BusinessLogo_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrashItem" ADD CONSTRAINT "TrashItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
