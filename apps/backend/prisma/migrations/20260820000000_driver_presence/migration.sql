-- CreateEnum
CREATE TYPE "DriverPresenceState" AS ENUM ('OFFLINE', 'AVAILABLE', 'PENDING_OFFER', 'ACCEPTED_JOB', 'ON_TRIP', 'BREAK');

-- CreateTable
CREATE TABLE "driver_presence" (
    "driver_id" INTEGER NOT NULL,
    "status" "DriverPresenceState" NOT NULL DEFAULT 'OFFLINE',
    "current_booking_id" INTEGER,
    "current_leg_id" INTEGER,
    "last_seen_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_presence_pkey" PRIMARY KEY ("driver_id")
);

-- CreateIndex
CREATE INDEX "driver_presence_status_idx" ON "driver_presence"("status");

-- CreateIndex
CREATE INDEX "driver_presence_current_leg_id_idx" ON "driver_presence"("current_leg_id");

-- AddForeignKey
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_current_booking_id_fkey" FOREIGN KEY ("current_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_current_leg_id_fkey" FOREIGN KEY ("current_leg_id") REFERENCES "legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill：既有 Driver 依目前的 isOnline 决定初始状态，lastSeenAt 用 onlineSince（在线的话）
-- 或 created_at（离线的话，至少给个不是 null 的起始值，避免第一次读到全新装置看起来像
-- "从来没上线过"跟"曾经上线过但现在离线"混在一起分不清楚——离线但有 lastSeenAt 才是合理的初始状态）。
INSERT INTO "driver_presence" ("driver_id", "status", "last_seen_at", "updated_at")
SELECT
  d.id,
  CASE WHEN d.is_online THEN 'AVAILABLE'::"DriverPresenceState" ELSE 'OFFLINE'::"DriverPresenceState" END,
  COALESCE(d.online_since, d.created_at),
  now()
FROM "drivers" d
ON CONFLICT ("driver_id") DO NOTHING;
