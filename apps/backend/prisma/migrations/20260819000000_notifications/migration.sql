-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('DRIVER', 'DISPATCHER', 'ADMIN');

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "driver_id" INTEGER,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "related_booking_id" INTEGER,
    "related_url" TEXT,
    "source_activity_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_driver_id_is_read_created_at_idx" ON "notifications"("driver_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_audience_is_read_created_at_idx" ON "notifications"("audience", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_related_booking_id_idx" ON "notifications"("related_booking_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_booking_id_fkey" FOREIGN KEY ("related_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_activity_id_fkey" FOREIGN KEY ("source_activity_id") REFERENCES "activity_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
