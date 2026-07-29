-- ============================================================
-- Notification Center — RBAC 权限授予（纯资料操作）
-- 见 apps/backend/src/common/permissions.ts 的 DEFAULT_ROLE_PERMISSIONS：
--   notification:read       -> OWNER/MANAGER/DISPATCHER
--   notification:write      -> OWNER/MANAGER（手动发公告）
--   driverNotification:self -> DRIVER
-- ============================================================

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'notification:read'
FROM "roles" r
WHERE r.key IN ('OWNER', 'MANAGER', 'DISPATCHER')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'notification:read'
  );

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'notification:write'
FROM "roles" r
WHERE r.key IN ('OWNER', 'MANAGER')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'notification:write'
  );

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'driverNotification:self'
FROM "roles" r
WHERE r.key = 'DRIVER'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'driverNotification:self'
  );
