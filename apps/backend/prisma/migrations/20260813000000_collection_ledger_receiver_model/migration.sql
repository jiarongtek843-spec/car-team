-- Module 13（Collection Ledger Schema）：新增 Collected By / Receiver，
-- 让 Collection 明确记录「谁收了钱」而不是只靠 paymentMethod 间接推断。
-- 设计依据：docs/design/collection-module-v1.md 第 7/8 章。
--
-- 这个 Migration 只处理 Schema/Backfill，不改动任何 API/Service/Settlement 逻辑：
-- - collectedBy 有 DEFAULT 'DRIVER'，所以既有的 collection.service.ts createCollection()
--   完全不用改就能继续编译、继续正常运作（新建的 Collection 一律沿用 DRIVER，跟目前唯一
--   支持的业务流程一致）。
-- - driver_id 从 NOT NULL 放宽成可为 NULL，是为了未来 Collected By = COMPANY 时可以不挂
--   Driver；这次不会有任何既有资料因为这个放宽而被改动。

-- CreateEnum
CREATE TYPE "CollectedBy" AS ENUM ('DRIVER', 'COMPANY');

-- CreateEnum
CREATE TYPE "CollectionReceiverType" AS ENUM ('DRIVER', 'COMPANY');

-- DropForeignKey（先移除旧的 NOT NULL 版本 FK，等一下用允许 NULL 的版本重建）
ALTER TABLE "collections" DROP CONSTRAINT "collections_driver_id_fkey";

-- AlterTable：新增栏位。collected_by/receiver_type 都先给 DEFAULT 'DRIVER'，让既有资料
-- 在 ADD COLUMN 当下就自动落在「沿用既有唯一流程＝Driver 代收」这个安全默认值，
-- 下面的 Backfill 区块再依 paymentMethod 精修（目前只有 TRANSFER_TO_COMPANY 会被改判为 COMPANY）。
ALTER TABLE "collections"
  ADD COLUMN "collected_by" "CollectedBy" NOT NULL DEFAULT 'DRIVER',
  ADD COLUMN "receiver_type" "CollectionReceiverType" NOT NULL DEFAULT 'DRIVER',
  ADD COLUMN "receiver_id" INTEGER,
  ADD COLUMN "receiver_label" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "driver_id" DROP NOT NULL;

-- ============================================================
-- Backfill：既有 Collection 记录的 Collected By / Receiver
-- ============================================================
-- 目前 dev DB 里 collections 是空表（0 笔资料），下面这些 UPDATE 这次不会改动任何一笔资料，
-- 但为了让这个 Migration 在「已经有资料」的环境（例如未来的 staging/production）套用时行为
-- 正确、可预期，规则照样完整写出来，不能因为本地是空的就省略。

-- 规则 A：paymentMethod = TRANSFER_TO_COMPANY → 客户直接付给公司，Driver 从未持有这笔钱，
-- 判定为 Collected By = COMPANY。Receiver 结构化清单还没设计（见 collection-module-v1.md
-- 第 12 章问题 1），receiver_id 先留空，只标记 receiver_type，避免编造一个不存在的账户 ID。
UPDATE "collections"
SET "collected_by" = 'COMPANY',
    "receiver_type" = 'COMPANY'
WHERE "payment_method" = 'TRANSFER_TO_COMPANY';

-- 规则 B：paymentMethod IN (CASH, TRANSFER_TO_DRIVER) → 明确是 Driver 代收，
-- 判定为 Collected By = DRIVER，receiver_id 直接对应既有的 driver_id
-- （ADD COLUMN 阶段的 DEFAULT 已经把 collected_by/receiver_type 落在 DRIVER，
-- 这里只需要额外补上 receiver_id）。
UPDATE "collections"
SET "receiver_id" = "driver_id"
WHERE "payment_method" IN ('CASH', 'TRANSFER_TO_DRIVER')
  AND "collected_by" = 'DRIVER';

-- 规则 C：paymentMethod IN (TNG, OTHER) → 无法从付款方式安全判断钱实际到了 Driver 手上
-- 还是公司手上（TNG 可能转去 Driver 或公司的电子钱包，OTHER 完全不明确）。这次刻意
-- 不静默猜测：不特别覆写，让它们停留在 ADD COLUMN 阶段的 DEFAULT 值（DRIVER）——
-- 这是「明确记录下来、可回溯审查」的默认值，不是没有交代的隐性假设。哪些既有记录
-- 落在这条规则，见下方 Migration Report 查询，或对照 docs/modules/collection.md 的
-- Backfill 结果小节（部署到有资料的环境后应该重新跑一次这个查询确认清单）。

-- ============================================================
-- Migration Report 查询（仅供人工复核用，不是 Schema 变更的一部分）
-- ============================================================
-- 需要人工复核 Collected By 判定是否正确的既有记录（payment_method 为 TNG/OTHER）：
--
--   SELECT id, booking_id, driver_id, payment_method, amount_cents, collected_at
--   FROM collections
--   WHERE payment_method IN ('TNG', 'OTHER')
--   ORDER BY id;
--
-- 部署这个 Migration 之后，在目标环境跑一次上面这段查询，把结果贴进
-- docs/modules/collection.md 的 Backfill 结果小节（本地 dev DB 目前是 0 笔）。

-- CreateIndex
CREATE INDEX "collections_driver_id_status_collected_at_idx" ON "collections"("driver_id", "status", "collected_at");

-- CreateIndex
CREATE INDEX "collections_booking_id_idx" ON "collections"("booking_id");

-- CreateIndex
CREATE INDEX "collections_status_idx" ON "collections"("status");

-- CreateIndex
CREATE INDEX "collections_collected_by_idx" ON "collections"("collected_by");

-- CreateIndex
CREATE INDEX "collections_receiver_type_receiver_id_idx" ON "collections"("receiver_type", "receiver_id");

-- AddForeignKey（driver_id 现在允许 NULL；Driver 被删除时既有 Collection 的 driver_id
-- 自动变成 NULL，不会阻挡 Driver 删除，也不会连带删除 Collection 记录——Collection 是
-- 金额帐本，Append-Only，任何情况都不能被连带删除，见 financial-model-v2.md 第 2 章）
--
-- 註：这个 SET NULL 行为在下一个 Migration（20260813000001_collection_driver_fk_restrict）
-- 改成 RESTRICT，跟 wallet_transactions/trip_expenses 两本姊妹 Ledger 的 driver 外键
-- 行为保持一致。这里维持 Migration 当初实际套用时的原始写法，不回头编辑已经 Apply 过的
-- Migration 文件（即使还没 commit 到 git）——用新的 Migration 做修正，是这个专案一贯的
-- 纪律，见 wallet-migration.md「Never rewrite an applied migration」的相同做法。
ALTER TABLE "collections" ADD CONSTRAINT "collections_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- CHECK Constraints（Prisma schema 语法本身不支援任意 CHECK，写在这里手动加）
-- ============================================================

-- 规则 2（业务规则）：Collected By = DRIVER 时必须关联具体 Driver。
-- 既有资料 100% 符合（原本 driver_id 就是 NOT NULL），新资料由 collection.service.ts
-- 的既有 Validation 保证（createCollection 一定会传入 driverId）。
ALTER TABLE "collections"
  ADD CONSTRAINT "collections_collected_by_driver_check"
  CHECK ("collected_by" <> 'DRIVER' OR "driver_id" IS NOT NULL);

-- receiverType 是 receiverId 指向哪一种实体的判别栏位，v1 只支援 DRIVER/COMPANY 两种，
-- 两者取值必须跟 collectedBy 一致（现有 create 流程从不写入 receiverType，会一直停留在
-- ADD COLUMN 阶段的 DEFAULT 'DRIVER'，跟同一笔记录默认的 collectedBy='DRIVER' 天然一致，
-- 不会违反这个约束；只有等到之后的 API 阶段真的支援写入不同组合时才有意义）。
ALTER TABLE "collections"
  ADD CONSTRAINT "collections_receiver_type_matches_collected_by_check"
  CHECK ("receiver_type" IS NULL OR "receiver_type"::text = "collected_by"::text);

-- receiverType = DRIVER 时，如果有填 receiverId，必须等于 driverId（同一个实体，
-- 不允许两个栏位互相矛盾）；允许 receiverId 是 NULL（代表这个栏位还没被填过）。
ALTER TABLE "collections"
  ADD CONSTRAINT "collections_receiver_id_matches_driver_check"
  CHECK ("receiver_type" IS DISTINCT FROM 'DRIVER' OR "receiver_id" IS NULL OR "receiver_id" = "driver_id");
