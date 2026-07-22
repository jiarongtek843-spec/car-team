-- ============================================================
-- Module 10: Booking Charge API — RBAC 权限授予（纯资料操作）
-- 见 apps/backend/src/common/permissions.ts 的 DEFAULT_ROLE_PERMISSIONS：
--   bookingCharge:read  -> OWNER / MANAGER / DISPATCHER
--   bookingCharge:write -> OWNER / MANAGER / DISPATCHER
--   bookingCharge:void  -> OWNER / MANAGER only（Dispatcher 不能 Void）
-- 跟 Module 7/8 一样，新增 Permission Key 只是插入 role_permissions 资料，
-- 不需要改任何业务逻辑代码。
-- ============================================================

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('bookingCharge:read'),
  ('bookingCharge:write'),
  ('bookingCharge:void')
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
  ('bookingCharge:read'),
  ('bookingCharge:write')
) AS p(permission_key)
WHERE r.key = 'DISPATCHER'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = p.permission_key
  );
