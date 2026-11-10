-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "BrandBooking" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandBooking_creatorId_startsAt_idx" ON "BrandBooking"("creatorId", "startsAt");

-- AddForeignKey
ALTER TABLE "BrandBooking" ADD CONSTRAINT "BrandBooking_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandBooking" ADD CONSTRAINT "BrandBooking_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandBooking" ADD CONSTRAINT "BrandBooking_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PartnerProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
