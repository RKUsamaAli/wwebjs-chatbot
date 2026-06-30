-- AlterTable: add nullable waId to Contact (unique index added separately,
-- since SQLite cannot add a UNIQUE column in a single ALTER TABLE statement)
ALTER TABLE "Contact" ADD COLUMN "waId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_waId_key" ON "Contact"("waId");

-- AlterTable: add nullable playedAt to Message
ALTER TABLE "Message" ADD COLUMN "playedAt" DATETIME;
