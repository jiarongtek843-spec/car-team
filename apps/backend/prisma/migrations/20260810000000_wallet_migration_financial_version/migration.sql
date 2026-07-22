-- Module 12 (Wallet Migration): Financial Version Cut-over + Revenue Share Payout。
--
-- Migration Cut-over 设计：
--   1. 新增 financial_version 栏位，ADD COLUMN 的 DEFAULT 先设成 'V1'——Postgres 会
--      自动帮「这个 migration 部署之前就存在」的所有既有 Booking 回填成 'V1'。
--   2. 再用一句 ALTER COLUMN SET DEFAULT 把栏位往后的默认值改成 'V2'——从这一刻起，
--      任何新建立的 Booking（没有明确指定 financial_version 的）都会自动变成 'V2'。
-- 这两步合起来，migration 部署的当下就是「Cut-over 时间点」本身：不需要额外的
-- 应用层判断「现在是不是已经过了 Cut-over 日期」，DB 的两段式 DEFAULT 天然做到了
-- 「旧 Booking 不主动迁移、新 Booking 自动采用新版本」。
CREATE TYPE "FinancialVersion" AS ENUM ('V1', 'V2');

ALTER TABLE "bookings" ADD COLUMN "financial_version" "FinancialVersion" NOT NULL DEFAULT 'V1';
ALTER TABLE "bookings" ALTER COLUMN "financial_version" SET DEFAULT 'V2';

CREATE INDEX "bookings_financial_version_idx" ON "bookings"("financial_version");

-- Financial V2 专用的 WalletTransactionType：Revenue Sharing Issue Wallet 时，按 Leg 的
-- earningAllocationCents 比例分配 Snapshot.driverPoolCents 产生。V1 Booking 永远不会有
-- 这个类型（继续用既有的 LEG_EARNING），两者不会同时出现在同一张 Booking 底下。
ALTER TYPE "WalletTransactionType" ADD VALUE 'REVENUE_SHARE_PAYOUT';

-- 单向参照：这笔 Wallet Transaction 是哪一笔 Revenue Sharing Snapshot 分出来的。
-- Snapshot 本身是 Append Only，这里只新增参照栏位，不会有任何代码回头去改 Snapshot。
ALTER TABLE "wallet_transactions" ADD COLUMN "revenue_snapshot_id" INTEGER;
CREATE INDEX "wallet_transactions_revenue_snapshot_id_idx" ON "wallet_transactions"("revenue_snapshot_id");
ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_revenue_snapshot_id_fkey"
  FOREIGN KEY ("revenue_snapshot_id") REFERENCES "revenue_sharing_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
