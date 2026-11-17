-- CreateTable
CREATE TABLE "DishImage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DishImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DishImage_businessId_idx" ON "DishImage"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "DishImage_businessId_menuItemId_key" ON "DishImage"("businessId", "menuItemId");

-- AddForeignKey
ALTER TABLE "DishImage" ADD CONSTRAINT "DishImage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishImage" ADD CONSTRAINT "DishImage_businessId_menuItemId_fkey" FOREIGN KEY ("businessId", "menuItemId") REFERENCES "MenuItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

