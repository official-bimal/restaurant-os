-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'DELIVERY';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "activeMenuSetId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryName" TEXT,
ADD COLUMN     "deliveryPhone" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus",
ADD COLUMN     "riderName" TEXT;

-- CreateTable
CREATE TABLE "AddOnGroup" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddOnGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAddOnGroup" (
    "businessId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "MenuItemAddOnGroup_pkey" PRIMARY KEY ("menuItemId","groupId")
);

-- CreateTable
CREATE TABLE "OrderItemAddOn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "OrderItemAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuSet" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuSetItem" (
    "businessId" TEXT NOT NULL,
    "menuSetId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,

    CONSTRAINT "MenuSetItem_pkey" PRIMARY KEY ("menuSetId","menuItemId")
);

-- CreateTable
CREATE TABLE "MenuSchedule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "menuSetId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "MenuSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AddOnGroup_businessId_id_key" ON "AddOnGroup"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AddOnGroup_businessId_name_key" ON "AddOnGroup"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_businessId_id_key" ON "AddOn"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_groupId_name_key" ON "AddOn"("groupId", "name");

-- CreateIndex
CREATE INDEX "MenuItemAddOnGroup_businessId_groupId_idx" ON "MenuItemAddOnGroup"("businessId", "groupId");

-- CreateIndex
CREATE INDEX "OrderItemAddOn_businessId_orderItemId_idx" ON "OrderItemAddOn"("businessId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuSet_businessId_id_key" ON "MenuSet"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MenuSet_businessId_name_key" ON "MenuSet"("businessId", "name");

-- CreateIndex
CREATE INDEX "MenuSetItem_businessId_menuItemId_idx" ON "MenuSetItem"("businessId", "menuItemId");

-- CreateIndex
CREATE INDEX "MenuSchedule_businessId_dayOfWeek_idx" ON "MenuSchedule"("businessId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "AddOnGroup" ADD CONSTRAINT "AddOnGroup_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_businessId_groupId_fkey" FOREIGN KEY ("businessId", "groupId") REFERENCES "AddOnGroup"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAddOnGroup" ADD CONSTRAINT "MenuItemAddOnGroup_businessId_menuItemId_fkey" FOREIGN KEY ("businessId", "menuItemId") REFERENCES "MenuItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAddOnGroup" ADD CONSTRAINT "MenuItemAddOnGroup_businessId_groupId_fkey" FOREIGN KEY ("businessId", "groupId") REFERENCES "AddOnGroup"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAddOn" ADD CONSTRAINT "OrderItemAddOn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSet" ADD CONSTRAINT "MenuSet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSetItem" ADD CONSTRAINT "MenuSetItem_businessId_menuSetId_fkey" FOREIGN KEY ("businessId", "menuSetId") REFERENCES "MenuSet"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSetItem" ADD CONSTRAINT "MenuSetItem_businessId_menuItemId_fkey" FOREIGN KEY ("businessId", "menuItemId") REFERENCES "MenuItem"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSchedule" ADD CONSTRAINT "MenuSchedule_businessId_menuSetId_fkey" FOREIGN KEY ("businessId", "menuSetId") REFERENCES "MenuSet"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

