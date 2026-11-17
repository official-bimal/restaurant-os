-- Branches. Every existing business gets one 'Main branch' that all its floor, orders,
-- invoices and day closes are moved into, so nothing changes for a single-branch business.
DROP INDEX "Area_businessId_name_key";
DROP INDEX "DiningTable_businessId_label_key";
DROP INDEX "Order_businessId_status_idx";
DROP INDEX "Invoice_businessId_createdAt_idx";
DROP INDEX "DayClose_businessId_date_key";
ALTER TABLE "Membership" ADD COLUMN     "allBranches" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MembershipBranch" (
    "membershipId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,

    CONSTRAINT "MembershipBranch_pkey" PRIMARY KEY ("membershipId","branchId")
);
CREATE UNIQUE INDEX "Branch_businessId_id_key" ON "Branch"("businessId", "id");
CREATE UNIQUE INDEX "Branch_businessId_name_key" ON "Branch"("businessId", "name");
CREATE INDEX "MembershipBranch_businessId_branchId_idx" ON "MembershipBranch"("businessId", "branchId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "Branch" ("id", "businessId", "name") SELECT 'brn_' || replace(gen_random_uuid()::text, '-', ''), "id", 'Main branch' FROM "Business";
ALTER TABLE "Area" ADD COLUMN "branchId" TEXT;
UPDATE "Area" SET "branchId" = (SELECT b."id" FROM "Branch" b WHERE b."businessId" = "Area"."businessId" ORDER BY b."createdAt" LIMIT 1);
ALTER TABLE "Area" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "DiningTable" ADD COLUMN "branchId" TEXT;
UPDATE "DiningTable" SET "branchId" = (SELECT b."id" FROM "Branch" b WHERE b."businessId" = "DiningTable"."businessId" ORDER BY b."createdAt" LIMIT 1);
ALTER TABLE "DiningTable" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Order" ADD COLUMN "branchId" TEXT;
UPDATE "Order" SET "branchId" = (SELECT b."id" FROM "Branch" b WHERE b."businessId" = "Order"."businessId" ORDER BY b."createdAt" LIMIT 1);
ALTER TABLE "Order" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Invoice" ADD COLUMN "branchId" TEXT;
UPDATE "Invoice" SET "branchId" = (SELECT b."id" FROM "Branch" b WHERE b."businessId" = "Invoice"."businessId" ORDER BY b."createdAt" LIMIT 1);
ALTER TABLE "Invoice" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "DayClose" ADD COLUMN "branchId" TEXT;
UPDATE "DayClose" SET "branchId" = (SELECT b."id" FROM "Branch" b WHERE b."businessId" = "DayClose"."businessId" ORDER BY b."createdAt" LIMIT 1);
ALTER TABLE "DayClose" ALTER COLUMN "branchId" SET NOT NULL;
CREATE UNIQUE INDEX "Area_branchId_name_key" ON "Area"("branchId", "name");
CREATE INDEX "DiningTable_businessId_branchId_idx" ON "DiningTable"("businessId", "branchId");
CREATE UNIQUE INDEX "DiningTable_branchId_label_key" ON "DiningTable"("branchId", "label");
CREATE INDEX "Order_businessId_branchId_status_idx" ON "Order"("businessId", "branchId", "status");
CREATE INDEX "Invoice_businessId_branchId_createdAt_idx" ON "Invoice"("businessId", "branchId", "createdAt");
CREATE UNIQUE INDEX "DayClose_branchId_date_key" ON "DayClose"("branchId", "date");
ALTER TABLE "Area" ADD CONSTRAINT "Area_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
