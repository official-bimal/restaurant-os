-- Delivery fee and links, guest add-ons, add-on stock use, per-branch menu sets, notification read state.
-- Hand-ordered so existing menu-set data is carried over to branches before the old column is dropped.

-- Per-branch menu sets: the hand-picked set moves from the business to each of its branches.
ALTER TABLE "Branch" ADD COLUMN "activeMenuSetId" TEXT;
UPDATE "Branch" b SET "activeMenuSetId" = (SELECT bz."activeMenuSetId" FROM "Business" bz WHERE bz."id" = b."businessId");

-- Schedule rows become per branch: the first branch keeps the row, every other branch gets a copy.
DROP INDEX "MenuSchedule_businessId_dayOfWeek_idx";
ALTER TABLE "MenuSchedule" ADD COLUMN "branchId" TEXT;
UPDATE "MenuSchedule" m SET "branchId" = (
  SELECT br."id" FROM "Branch" br WHERE br."businessId" = m."businessId" ORDER BY br."createdAt", br."id" LIMIT 1
);
INSERT INTO "MenuSchedule" ("id", "businessId", "branchId", "menuSetId", "dayOfWeek", "startMinute", "endMinute")
SELECT md5(random()::text || clock_timestamp()::text || m."id" || br."id"), m."businessId", br."id", m."menuSetId", m."dayOfWeek", m."startMinute", m."endMinute"
FROM "MenuSchedule" m
JOIN "Branch" br ON br."businessId" = m."businessId" AND br."id" <> m."branchId";
DELETE FROM "MenuSchedule" WHERE "branchId" IS NULL;
ALTER TABLE "MenuSchedule" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "Business" DROP COLUMN "activeMenuSetId";

-- AlterTable
ALTER TABLE "GuestSubmissionItem" ADD COLUMN     "addOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryZoneName" TEXT,
ADD COLUMN     "riderToken" TEXT,
ADD COLUMN     "trackingToken" TEXT;

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnStock" (
    "businessId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "AddOnStock_pkey" PRIMARY KEY ("addOnId","stockItemId")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_businessId_id_key" ON "DeliveryZone"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_branchId_name_key" ON "DeliveryZone"("branchId", "name");

-- CreateIndex
CREATE INDEX "AddOnStock_businessId_stockItemId_idx" ON "AddOnStock"("businessId", "stockItemId");

-- CreateIndex
CREATE INDEX "NotificationRead_businessId_idx" ON "NotificationRead"("businessId");

-- CreateIndex
CREATE INDEX "MenuSchedule_businessId_branchId_dayOfWeek_idx" ON "MenuSchedule"("businessId", "branchId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_riderToken_key" ON "Order"("riderToken");

-- AddForeignKey
ALTER TABLE "MenuSchedule" ADD CONSTRAINT "MenuSchedule_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnStock" ADD CONSTRAINT "AddOnStock_businessId_addOnId_fkey" FOREIGN KEY ("businessId", "addOnId") REFERENCES "AddOn"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnStock" ADD CONSTRAINT "AddOnStock_businessId_stockItemId_fkey" FOREIGN KEY ("businessId", "stockItemId") REFERENCES "StockItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
