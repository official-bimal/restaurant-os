-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "feedbackEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "googleReviewUrl" TEXT;

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "handledNote" TEXT,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_businessId_createdAt_idx" ON "Feedback"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_businessId_rating_handledAt_idx" ON "Feedback"("businessId", "rating", "handledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_businessId_invoiceId_key" ON "Feedback"("businessId", "invoiceId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_businessId_invoiceId_fkey" FOREIGN KEY ("businessId", "invoiceId") REFERENCES "Invoice"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

