-- ============================================================
-- Phase 1 Dispatch Engine（simplified，2026-07 scope reduction）：Send Offer 给全部合格
-- Driver（不分批），第一个 Accept 的赢，其他自动关闭，逾时整批 EXPIRED、退回 Dispatcher
-- 手动处理。没有 round/policyId 这些 Future Extension 栏位。
-- ============================================================

CREATE TYPE "DispatchOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

CREATE TABLE "dispatch_offers" (
    "id" SERIAL NOT NULL,
    "leg_id" INTEGER NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "status" "DispatchOfferStatus" NOT NULL DEFAULT 'PENDING',
    "distance_km" DOUBLE PRECISION,
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dispatch_offers_leg_id_status_idx" ON "dispatch_offers"("leg_id", "status");
CREATE INDEX "dispatch_offers_driver_id_status_idx" ON "dispatch_offers"("driver_id", "status");
CREATE INDEX "dispatch_offers_status_expires_at_idx" ON "dispatch_offers"("status", "expires_at");

ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_settings" ADD COLUMN "dispatch_offer_timeout_seconds" INTEGER NOT NULL DEFAULT 30;
