-- ============================================================
-- Mobile UX + Scheduling Sprint: Leg 新增 legType（OUTBOUND/RETURN/ADDITIONAL）
-- 让 Booking 表单能预设建立去程+回程两个 Leg，Dispatch/Driver Job 也能清楚
-- 标示这是哪一段行程。纯标签栏位，不影响任何既有状态机或财务计算逻辑。
-- ============================================================

-- 1) 新增 enum。
CREATE TYPE "LegType" AS ENUM ('OUTBOUND', 'RETURN', 'ADDITIONAL');

-- 2) 新增栏位，先给全部既有资料一个安全默认值（ADDITIONAL），
--    避免加 NOT NULL 栏位时对既有资料量大的环境造成整表锁定风险外的额外顾虑。
ALTER TABLE "legs" ADD COLUMN "leg_type" "LegType" NOT NULL DEFAULT 'ADDITIONAL';

-- 3) Backfill：既有资料里，同一张 Booking 底下 sequence=1 视为去程、sequence=2 视为回程，
--    这跟专案原本「新建 Booking 时预设先加一个去程 Leg、需要就再加一个回程 Leg」的
--    既有使用习惯一致；sequence>=3 维持 ADDITIONAL（新增栏位时的默认值，不需要另外处理）。
UPDATE "legs" SET "leg_type" = 'OUTBOUND' WHERE "sequence" = 1;
UPDATE "legs" SET "leg_type" = 'RETURN' WHERE "sequence" = 2;
