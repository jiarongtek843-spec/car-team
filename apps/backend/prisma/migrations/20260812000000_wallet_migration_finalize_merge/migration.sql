-- Module 12 (Wallet Migration) 业务流程调整：Revenue Sharing Finalize 现在会一并自动
-- 发放 Wallet Transaction，取消原本「Finalize 之后还要另外手动 Issue Wallet」这第二个
-- 步骤。对应两个改动：
--
-- 1. 新增 CompanySettings.allow_manager_finalize_revenue_sharing——「谁能执行 Finalize」
--    从「只有 Owner」变成可配置：默认 false（等同第一版维持只有 OWNER），未来 OWNER
--    可以透过 Company Settings 开放给 MANAGER，不需要再改代码或重新部署。
ALTER TABLE "company_settings"
  ADD COLUMN "allow_manager_finalize_revenue_sharing" BOOLEAN NOT NULL DEFAULT false;

-- 2. revenueSharing:issueWallet 这个独立的 Permission Key 不再需要（Issue Wallet 不再是
--    一个单独能被授权的动作，已经并进 Finalize 本身）——撤销上一个 migration
--    （20260811000000_wallet_migration_permissions）授予 OWNER 的这笔资料。不删除
--    Permission Key 本身在 permissions.ts 里的痕迹（那是代码变更，不是 migration 的事），
--    这里只清掉 DB 里已经授权的资料，维持 Append Only 的精神（用新 migration 撤销，
--    不回头改已经套用过的旧 migration）。
DELETE FROM "role_permissions" WHERE "permission_key" = 'revenueSharing:issueWallet';
