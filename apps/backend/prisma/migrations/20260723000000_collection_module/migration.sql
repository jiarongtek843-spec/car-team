-- CreateEnum
CREATE TYPE "CollectionPaymentMethod" AS ENUM ('CASH', 'TRANSFER_TO_DRIVER', 'TRANSFER_TO_COMPANY', 'TNG', 'OTHER');

-- CreateEnum
CREATE TYPE "CollectionPurpose" AS ENUM ('ITEM_PURCHASE', 'DELIVERY_FEE', 'PARCEL', 'EXTRA_CHARGE', 'PARKING', 'TOLL', 'OTHER');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('PENDING', 'COLLECTED', 'VERIFIED', 'SETTLED', 'VOIDED');

-- AlterTable: split existing net_amount_cents into wallet_amount_cents + collection_amount_cents
ALTER TABLE "settlements" ADD COLUMN     "collection_amount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wallet_amount_cents" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing settlements predate Collection module, so their net amount was entirely wallet earnings.
UPDATE "settlements" SET "wallet_amount_cents" = "net_amount_cents";

-- CreateTable
CREATE TABLE "collections" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "leg_id" INTEGER,
    "driver_id" INTEGER NOT NULL,
    "customer_name" TEXT,
    "purpose" "CollectionPurpose" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payment_method" "CollectionPaymentMethod" NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'PENDING',
    "collected_at" TIMESTAMP(3),
    "remark" TEXT,
    "proof_image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "verified_at" TIMESTAMP(3),
    "verified_by" INTEGER,
    "voided_at" TIMESTAMP(3),
    "voided_by" INTEGER,
    "void_reason" TEXT,
    "settled_at" TIMESTAMP(3),
    "settlement_id" INTEGER,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
