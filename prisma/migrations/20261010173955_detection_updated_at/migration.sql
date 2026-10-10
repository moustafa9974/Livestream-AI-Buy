-- AlterTable
ALTER TABLE "Detection" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ProductMatch_partnerProductId_idx" ON "ProductMatch"("partnerProductId");
