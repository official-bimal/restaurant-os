-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('CALL_WAITER', 'REQUEST_BILL', 'WATER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "guestOrderingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requireOrderApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "DiningTable" ADD COLUMN     "publicToken" TEXT NOT NULL DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text));

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSubmission" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "rejectReason" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "GuestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSubmissionItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "GuestSubmissionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TableSession_businessId_tableId_closedAt_idx" ON "TableSession"("businessId", "tableId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_businessId_id_key" ON "TableSession"("businessId", "id");

-- CreateIndex
CREATE INDEX "GuestSubmission_businessId_status_idx" ON "GuestSubmission"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSubmission_businessId_id_key" ON "GuestSubmission"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSubmission_businessId_idempotencyKey_key" ON "GuestSubmission"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GuestSubmissionItem_businessId_submissionId_idx" ON "GuestSubmissionItem"("businessId", "submissionId");

-- CreateIndex
CREATE INDEX "ServiceRequest_businessId_status_idx" ON "ServiceRequest"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_publicToken_key" ON "DiningTable"("publicToken");

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_businessId_tableId_fkey" FOREIGN KEY ("businessId", "tableId") REFERENCES "DiningTable"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_businessId_tableId_fkey" FOREIGN KEY ("businessId", "tableId") REFERENCES "DiningTable"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "TableSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmissionItem" ADD CONSTRAINT "GuestSubmissionItem_businessId_submissionId_fkey" FOREIGN KEY ("businessId", "submissionId") REFERENCES "GuestSubmission"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_businessId_tableId_fkey" FOREIGN KEY ("businessId", "tableId") REFERENCES "DiningTable"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "TableSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

