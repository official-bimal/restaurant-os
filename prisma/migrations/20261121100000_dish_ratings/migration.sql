-- CreateTable
CREATE TABLE "DishRating" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DishRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DishRating_businessId_menuItemId_idx" ON "DishRating"("businessId", "menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DishRating_businessId_invoiceId_menuItemId_key" ON "DishRating"("businessId", "invoiceId", "menuItemId");

-- AddForeignKey
ALTER TABLE "DishRating" ADD CONSTRAINT "DishRating_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishRating" ADD CONSTRAINT "DishRating_businessId_invoiceId_fkey" FOREIGN KEY ("businessId", "invoiceId") REFERENCES "Invoice"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

