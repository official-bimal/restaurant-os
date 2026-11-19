-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "wifiHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wifiName" TEXT,
ADD COLUMN     "wifiPassword" TEXT,
ADD COLUMN     "wifiSecurity" TEXT NOT NULL DEFAULT 'WPA';

