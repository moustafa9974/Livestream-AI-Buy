-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "recapAt" TIMESTAMP(3),
ADD COLUMN     "recapText" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "zapierStatus" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KernelSession" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "kernelSessionId" TEXT NOT NULL,
    "liveViewUrl" TEXT,
    "status" TEXT NOT NULL,
    "stopReason" TEXT,
    "framesSent" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "KernelSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_creatorId_createdAt_idx" ON "Notification"("creatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KernelSession_kernelSessionId_key" ON "KernelSession"("kernelSessionId");

-- CreateIndex
CREATE INDEX "KernelSession_status_idx" ON "KernelSession"("status");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KernelSession" ADD CONSTRAINT "KernelSession_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
