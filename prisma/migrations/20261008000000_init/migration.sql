-- pgvector for embeddings (Detection.embedding, PartnerProduct.embedding).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StreamSourceType" AS ENUM ('upload', 'screen', 'youtube', 'kernel_url');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('idle', 'live', 'ended');

-- CreateEnum
CREATE TYPE "DetectionState" AS ENUM ('candidate', 'visible', 'pinned', 'hidden');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('partner', 'channel3');

-- CreateEnum
CREATE TYPE "MatchKind" AS ENUM ('exact', 'similar');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'APPROVED', 'CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'PAYOUT_SENT', 'PAID', 'FAILED', 'UNCLAIMED', 'RETURNED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('ai', 'webhook', 'creator', 'viewer', 'system', 'kernel');

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "payoutEmail" TEXT NOT NULL,
    "payoutCurrency" TEXT NOT NULL DEFAULT 'USD',
    "commissionRateBps" INTEGER NOT NULL DEFAULT 1000,
    "language" TEXT NOT NULL DEFAULT 'en',
    "zapierWebhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "StreamSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "videoAssetUrl" TEXT,
    "status" "StreamStatus" NOT NULL DEFAULT 'idle',
    "consentOwnContent" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "frameIntervalSec" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "tsSec" DOUBLE PRECISION NOT NULL,
    "dHash" TEXT NOT NULL,
    "imageUrl" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(768),
    "bestFrameId" TEXT,
    "bbox" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "firstSeenSec" DOUBLE PRECISION NOT NULL,
    "lastSeenSec" DOUBLE PRECISION NOT NULL,
    "state" "DetectionState" NOT NULL DEFAULT 'candidate',
    "mentionedInAudio" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMatch" (
    "id" TEXT NOT NULL,
    "detectionId" TEXT NOT NULL,
    "source" "MatchSource" NOT NULL,
    "partnerProductId" TEXT,
    "externalRef" JSONB,
    "score" DOUBLE PRECISION NOT NULL,
    "kind" "MatchKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerProduct" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "images" TEXT[],
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewerSession" (
    "id" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "detectionId" TEXT,
    "partnerProductId" TEXT NOT NULL,
    "viewerSessionId" TEXT NOT NULL,
    "tsSec" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "viewerSessionId" TEXT NOT NULL,
    "attributionId" TEXT,
    "items" JSONB NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reversedMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3) NOT NULL,
    "payoutBatchId" TEXT,
    "payoutItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "paypalBatchId" TEXT,
    "senderBatchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "paypalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "source" "AuditSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "provider" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("provider","window")
);

-- CreateTable
CREATE TABLE "ApiCache" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_slug_key" ON "Creator"("slug");

-- CreateIndex
CREATE INDEX "Stream_creatorId_idx" ON "Stream"("creatorId");

-- CreateIndex
CREATE INDEX "Frame_streamId_processed_idx" ON "Frame"("streamId", "processed");

-- CreateIndex
CREATE INDEX "Detection_streamId_state_idx" ON "Detection"("streamId", "state");

-- CreateIndex
CREATE INDEX "ProductMatch_detectionId_idx" ON "ProductMatch"("detectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerSession_anonId_key" ON "ViewerSession"("anonId");

-- CreateIndex
CREATE INDEX "Attribution_streamId_idx" ON "Attribution"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalOrderId_key" ON "Order"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalCaptureId_key" ON "Order"("paypalCaptureId");

-- CreateIndex
CREATE INDEX "Commission_creatorId_status_idx" ON "Commission"("creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_orderId_creatorId_key" ON "Commission"("orderId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_paypalBatchId_key" ON "PayoutBatch"("paypalBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_senderBatchId_key" ON "PayoutBatch"("senderBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_paypalEventId_key" ON "WebhookEvent"("paypalEventId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ApiCache_kind_idx" ON "ApiCache"("kind");

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMatch" ADD CONSTRAINT "ProductMatch_detectionId_fkey" FOREIGN KEY ("detectionId") REFERENCES "Detection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMatch" ADD CONSTRAINT "ProductMatch_partnerProductId_fkey" FOREIGN KEY ("partnerProductId") REFERENCES "PartnerProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerProduct" ADD CONSTRAINT "PartnerProduct_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_detectionId_fkey" FOREIGN KEY ("detectionId") REFERENCES "Detection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_partnerProductId_fkey" FOREIGN KEY ("partnerProductId") REFERENCES "PartnerProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_viewerSessionId_fkey" FOREIGN KEY ("viewerSessionId") REFERENCES "ViewerSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_viewerSessionId_fkey" FOREIGN KEY ("viewerSessionId") REFERENCES "ViewerSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "Attribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

