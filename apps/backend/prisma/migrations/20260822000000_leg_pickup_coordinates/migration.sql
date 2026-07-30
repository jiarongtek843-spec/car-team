-- Driver Matching Engine: optional pickup coordinates on Leg, populated later by
-- geocoding/map-selection features. No backfill needed (nullable, additive only).
ALTER TABLE "legs" ADD COLUMN "pickup_latitude" DOUBLE PRECISION;
ALTER TABLE "legs" ADD COLUMN "pickup_longitude" DOUBLE PRECISION;
