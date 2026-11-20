-- AlterTable
ALTER TABLE "Business" ADD COLUMN "guestPayEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "byGuest" BOOLEAN NOT NULL DEFAULT false;
