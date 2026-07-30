-- Stabilization: add missing indexes on the tables queried most frequently by
-- driverId/status/date-range filters. All additive, no data changes.
CREATE INDEX "bookings_status_created_at_idx" ON "bookings"("status", "created_at");
CREATE INDEX "legs_driver_id_status_idx" ON "legs"("driver_id", "status");
CREATE INDEX "legs_status_idx" ON "legs"("status");
CREATE INDEX "wallet_transactions_driver_id_status_effective_date_idx" ON "wallet_transactions"("driver_id", "status", "effective_date");
CREATE INDEX "settlements_driver_id_status_idx" ON "settlements"("driver_id", "status");
