-- ============================================================
-- Module 11: Revenue Sharing API — RBAC 权限授予（纯资料操作）
-- 见 apps/backend/src/common/permissions.ts 的 DEFAULT_ROLE_PERMISSIONS：
--   revenueSharing:read     -> OWNER / MANAGER / DISPATCHER
--   revenueSharing:preview  -> OWNER / MANAGER only
--   revenueSharing:finalize -> OWNER / MANAGER only（Dispatcher 是 View Only）
-- 跟 Module 7/8/10 一样，新增 Permission Key 只是插入 role_permissions 资料，
-- 不需要改任何业务逻辑代码。
-- ============================================================

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('revenueSharing:read'),
  ('revenueSharing:preview'),
  ('revenueSharing:finalize')
) AS p(permission_key)
WHERE r.key IN ('OWNER', 'MANAGER')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = p.permission_key
  );

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('revenueSharing:read')
) AS p(permission_key)
WHERE r.key = 'DISPATCHER'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = p.permission_key
  );
