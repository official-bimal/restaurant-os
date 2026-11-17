-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "clockRadiusMeters" INTEGER NOT NULL DEFAULT 150;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "clockRequireLocation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "inDistanceM" INTEGER,
ADD COLUMN     "outAway" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outDistanceM" INTEGER;

