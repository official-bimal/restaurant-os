-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "moneyAccount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "entryKind" TEXT,
ADD COLUMN     "party" TEXT;


-- The cash drawer, bank, wallet and card accounts the software already posts to are money accounts.
UPDATE "Account" SET "moneyAccount" = true WHERE "key" IN ('CASH', 'BANK', 'WALLET', 'CARD');
