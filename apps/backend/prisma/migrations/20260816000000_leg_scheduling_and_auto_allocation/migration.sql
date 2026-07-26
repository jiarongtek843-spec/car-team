-- ============================================================
-- Mobile UAT Round 2：Leg 新增 Estimated Duration / Estimated Finish Time
-- 排程栏位，以及 Driver Income 自动平分所需的 manual override 标记。
-- 三个栏位都 nullable / 有安全默认值，纯新增，不需要 backfill 既有资料
-- （既有 Leg 的 earningAllocationManual 默认 false，代表沿用「自动平分」，
-- 下一次触发 redistributeAutoAllocations 时会依照目前的 Driver Pool 重新算过）。
-- ============================================================

ALTER TABLE "legs" ADD COLUMN "estimated_duration_minutes" INTEGER;
ALTER TABLE "legs" ADD COLUMN "estimated_finish_at" TIMESTAMP(3);
ALTER TABLE "legs" ADD COLUMN "earning_allocation_manual" BOOLEAN NOT NULL DEFAULT false;
