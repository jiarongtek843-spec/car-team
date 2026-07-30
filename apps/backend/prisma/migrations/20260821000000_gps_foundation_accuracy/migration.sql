-- GPS Foundation: add optional accuracy to the existing latest-location table.
ALTER TABLE "driver_locations" ADD COLUMN "accuracy" DOUBLE PRECISION;
