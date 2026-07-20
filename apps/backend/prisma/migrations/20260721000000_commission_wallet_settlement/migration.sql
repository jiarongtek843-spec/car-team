-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('LEG_EARNING', 'MANUAL_ADJUSTMENT', 'SETTLEMENT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'SETTLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VOIDED');

-- AlterTable: add new commission columns first, backfill from the old car_fee (ringgit) into
-- total_amount_cents, THEN drop car_fee. car_fee was always "Booking 总价" conceptually, just in
-- ringgit units — this migrates it to cents instead of keeping two overlapping "total" columns.
ALTER TABLE "bookings" ADD COLUMN     "driver_pool_amount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platform_amount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platform_commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "platform_commission_value" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "total_amount_cents" INTEGER NOT NULL DEFAULT 0;

UPDATE "bookings" SET "total_amount_cents" = COALESCE("car_fee", 0) * 100;

ALTER TABLE "bookings" DROP COLUMN "car_fee";

-- AlterTable
ALTER TABLE "legs" ADD COLUMN     "earning_allocation_cents" INTEGER;

-- CreateTable
CREATE TABLE "company_settings" (
    "id" SERIAL NOT NULL,
    "default_commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "default_commission_value" INTEGER NOT NULL DEFAULT 15,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "booking_id" INTEGER,
    "leg_id" INTEGER,
    "transaction_type" "WalletTransactionType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "effective_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "settled_at" TIMESTAMP(3),
    "settlement_id" INTEGER,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "settlement_date" DATE NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "voided_at" TIMESTAMP(3),
    "voided_by" INTEGER,
    "void_reason" TEXT,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" SERIAL NOT NULL,
    "settlement_id" INTEGER NOT NULL,
    "wallet_transaction_id" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_leg_id_transaction_type_key" ON "wallet_transactions"("leg_id", "transaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reference_key" ON "settlements"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_items_wallet_transaction_id_key" ON "settlement_items"("wallet_transaction_id");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the single CompanySettings row if it doesn't already exist (let the SERIAL id
-- auto-assign so the sequence stays in sync).
INSERT INTO "company_settings" ("default_commission_type", "default_commission_value", "updated_at")
SELECT 'PERCENTAGE', 15, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "company_settings");
