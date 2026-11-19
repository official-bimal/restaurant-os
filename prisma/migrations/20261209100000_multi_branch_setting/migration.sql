-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "multiBranch" BOOLEAN NOT NULL DEFAULT false;


-- Businesses that already work in more than one branch keep seeing the branch features.
UPDATE "Business" SET "multiBranch" = true WHERE "id" IN (SELECT "businessId" FROM "Branch" WHERE "active" = true GROUP BY "businessId" HAVING COUNT(*) > 1);
