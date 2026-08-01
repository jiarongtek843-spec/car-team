-- ============================================================
-- 新增 FINANCE 角色：给老板/记帐用的「只看财务总数」帐号——
-- 抽成/分润（Revenue Sharing）、Collection 代收总数、Wallet、Settlement、
-- 以及 Company Settings 里设定的抽成比例，都是唯读；完全不给
-- booking/driver/dispatch/gps 相关权限，也不给任何 write 权限
-- （包含 revenueSharing:finalize——那是会把 Booking 财务状态收敛成
-- FINALIZED 的不可逆动作，不该给这个「只看」角色）。
-- ============================================================

INSERT INTO "roles" ("key", "name", "description") VALUES
  ('FINANCE', 'Finance', '只看财务总数（抽成/分润、Wallet、Settlement、Collection、Company Settings 抽成比例），不能碰派单/司机资料，没有任何 write 权限。');

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('companySettings:read'),
  ('wallet:read'),
  ('settlement:read'),
  ('collection:read'),
  ('revenueSharing:read'),
  ('revenueSharing:preview'),
  ('notification:read')
) AS p(permission_key)
WHERE r.key = 'FINANCE';
