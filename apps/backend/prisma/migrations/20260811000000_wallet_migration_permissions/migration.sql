-- ============================================================
-- Module 12: Wallet Migration — RBAC 权限授予（纯资料操作）
-- 见 apps/backend/src/common/permissions.ts 的 DEFAULT_ROLE_PERMISSIONS：
--   revenueSharing:issueWallet -> OWNER only（Manager/Dispatcher 在这个 Module 只有既有的
--   revenueSharing:read 可以看，不需要新的 View 权限 key）。
-- 跟 Module 7/8/10/11 一样，新增 Permission Key 只是插入 role_permissions 资料，
-- 不需要改任何业务逻辑代码。
-- ============================================================

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'revenueSharing:issueWallet'
FROM "roles" r
WHERE r.key = 'OWNER'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'revenueSharing:issueWallet'
  );
