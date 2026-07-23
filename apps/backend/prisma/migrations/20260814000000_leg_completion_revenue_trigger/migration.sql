-- Driver Earnings Auto-Trigger Bug Fix（2026-07 Railway Staging 验证发现）：
-- Financial V2 的 Booking，收入原本设计成完全依赖 Owner/Manager 手动呼叫
-- Revenue Sharing Finalize API 才会产生 Wallet Transaction，但前端从未做过这个
-- 手动按钮，导致所有 V2 Booking 的司机收入永远不会产生。修正为：Booking 底下
-- 第一条 Leg 完成时自动建立 Revenue Sharing Snapshot（等同自动 Finalize），
-- 之后每条 Leg 各自完成时立刻拿到自己那一份，不需要等整张 Booking 全部完成。
-- 这里只需要新增一个 enum 值区分触发来源（审计用），Snapshot 本身的建表结构、
-- CHECK constraint、Index 都不需要变动。
ALTER TYPE "RevenueSnapshotTrigger" ADD VALUE 'LEG_COMPLETED';
