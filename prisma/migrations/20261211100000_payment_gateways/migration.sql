-- CreateEnum
CREATE TYPE "PayProvider" AS ENUM ('ESEWA', 'KHALTI', 'FONEPAY', 'CONNECTIPS', 'IMEPAY', 'CARD');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "provider" "PayProvider",
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "PaymentSetting" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "PayProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'TEST',
    "merchantCode" TEXT,
    "secretSealed" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PayProvider" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'CREATED',
    "token" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "providerRef" TEXT,
    "reference" TEXT,
    "payUrl" TEXT,
    "checkout" JSONB,
    "failReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSetting_businessId_provider_key" ON "PaymentSetting"("businessId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_token_key" ON "PaymentIntent"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_uuid_key" ON "PaymentIntent"("uuid");

-- CreateIndex
CREATE INDEX "PaymentIntent_businessId_orderId_idx" ON "PaymentIntent"("businessId", "orderId");

-- CreateIndex
CREATE INDEX "PaymentIntent_businessId_status_idx" ON "PaymentIntent"("businessId", "status");

-- AddForeignKey
ALTER TABLE "PaymentSetting" ADD CONSTRAINT "PaymentSetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

