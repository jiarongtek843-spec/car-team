-- 修正上一个 Migration（20260813000000_collection_ledger_receiver_model）里
-- collections.driver_id 外键的删除策略：Prisma 对「optional 关联」的默认行为是
-- SET NULL，但这跟 wallet_transactions/trip_expenses 这两本姊妹 Ledger 的 driver
-- 外键行为（NO ACTION，实质等同 Restrict）不一致——financial ledger 的可追溯性应该
-- 优先于「可以删除」的方便性：只要 Driver 还有 Collection 记录，就不该让 Driver 被
-- 物理删除、留下一笔「不知道原本是哪个 Driver」的历史帐。
--
-- 没有回头编辑上一个已经 Apply 过的 Migration 文件，是因为它已经在本地 dev DB
-- 套用过（即使还没 commit 到 git）——跟这个专案一貫的纪律一致（Wallet Migration
-- 阶段也遇过同样情况，见 docs/modules/wallet-migration.md）：已经 Apply 的
-- Migration 一律用新的 Migration 修正，不直接改档案内容。
--
-- 目前 collections 表是空的（本地 dev DB 0 笔资料），这个改动不影响任何既有资料；
-- 即使未来有资料，这一步也只是收紧 FK 的删除策略，不改动任何一笔既有 collections 资料本身。

ALTER TABLE "collections" DROP CONSTRAINT "collections_driver_id_fkey";

ALTER TABLE "collections" ADD CONSTRAINT "collections_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
