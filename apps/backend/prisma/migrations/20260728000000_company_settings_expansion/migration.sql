-- ============================================================
-- Module 8: Company Settings 扩充
-- 1) company_settings 新增 General/Booking/GPS/Settlement/Collection 分类栏位
-- 2) 让 MANAGER/DISPATCHER/DRIVER 也能读取 Company Settings（原本 Module 7 只有
--    OWNER 有 companySettings:read）——写入权限仍然只有 OWNER，这里只加 read。
-- ============================================================

-- 1) company_settings 新增栏位。全部有 DEFAULT，Postgres 会自动帮既有那一笔资料补上
--    对应的默认值，不需要额外的 UPDATE backfill。
ALTER TABLE "company_settings"
  ADD COLUMN "company_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RM',
  ADD COLUMN "allow_manual_leg_allocation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "require_driver_accept" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "gps_upload_interval_seconds" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "connection_lost_timeout_seconds" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "offline_timeout_seconds" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "default_settlement_time" TEXT NOT NULL DEFAULT '21:00',
  ADD COLUMN "settlement_timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN "collection_verification_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "max_upload_file_size_mb" INTEGER NOT NULL DEFAULT 5;

-- 2) 补上 companySettings:read 给 MANAGER/DISPATCHER/DRIVER（OWNER 已经有，不重复插入）。
--    这是纯资料操作，跟 Module 7「新增角色权限不用改代码」的设计一致——只是这次是补一个
--    既有角色缺的权限，不是新增角色。
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'companySettings:read'
FROM "roles" r
WHERE r.key IN ('MANAGER', 'DISPATCHER', 'DRIVER')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'companySettings:read'
  );
