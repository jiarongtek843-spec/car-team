-- ============================================================
-- Module 7: RBAC — Role/Permission 数据表 + User.role 迁移到 FK
-- 操作顺序很重要（见 docs/modules/rbac.md 的 Migration 章节）：
--   1) 建表 -> 2) 种角色 -> 3) 种权限 -> 4) users 加 role_id（先允许 NULL）
--   -> 5) backfill role_id -> 6) role_id 收紧成 NOT NULL + 外键
--   -> 7) audit_logs.actor_role 从 enum 转 TEXT -> 8) 移除旧栏位跟旧 enum
-- 一定要等 users.role / audit_logs.actor_role 都不再引用 UserRole 型别，
-- 才能真的 DROP TYPE，否则 Postgres 会直接报错拒绝。
-- ============================================================

-- 1) 新建 roles / role_permissions 两张表
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

CREATE TABLE "role_permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_role_id_permission_key_key" ON "role_permissions"("role_id", "permission_key");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 种入 4 个初始角色。这是「参考资料」不是测试资料，所有环境都需要这 4 个角色存在，
--    所以放在 migration 里跟 `prisma migrate deploy` 一起自动跑（不是 seed.ts 的职责，
--    seed.ts 只负责建立 admin/driver01 这类纯测试用的登入帐号）。
INSERT INTO "roles" ("key", "name", "description") VALUES
  ('OWNER', 'Owner', '公司负责人，拥有所有权限，包含 Company Settings/Commission 设定。'),
  ('MANAGER', 'Manager', '日常车队营运：Booking、Driver、Dispatch、GPS、Wallet、Collection、Settlement，不含 Company Settings。'),
  ('DISPATCHER', 'Dispatcher', '派车专员：Booking、Dispatch Center、查看 Driver 与 GPS，不能碰 Wallet/Settlement/Collection/Commission。'),
  ('DRIVER', 'Driver', '司机，只能查看/操作自己的工作、GPS、收入、代收款、结算纪录。');

-- 3) 种入每个角色的初始权限。跟 apps/backend/src/common/permissions.ts 的
--    DEFAULT_ROLE_PERMISSIONS 保持一致——那份档案是给程式码（seed 脚本、未来的管理工具）
--    读的单一事实来源，这里是把同一份资料实际写进数据库。
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('booking:read'), ('booking:write'),
  ('driver:read'), ('driver:write'),
  ('dispatch:read'),
  ('gps:read'),
  ('wallet:read'), ('wallet:write'),
  ('settlement:read'), ('settlement:write'),
  ('collection:read'), ('collection:write'),
  ('companySettings:read'), ('companySettings:write')
) AS p(permission_key)
WHERE r.key = 'OWNER';

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('booking:read'), ('booking:write'),
  ('driver:read'), ('driver:write'),
  ('dispatch:read'),
  ('gps:read'),
  ('wallet:read'), ('wallet:write'),
  ('settlement:read'), ('settlement:write'),
  ('collection:read'), ('collection:write')
) AS p(permission_key)
WHERE r.key = 'MANAGER';

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('booking:read'), ('booking:write'),
  ('driver:read'),
  ('dispatch:read'),
  ('gps:read')
) AS p(permission_key)
WHERE r.key = 'DISPATCHER';

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.permission_key
FROM "roles" r
CROSS JOIN (VALUES
  ('driverJobs:self'),
  ('driverWallet:self'),
  ('driverCollection:self'),
  ('driverPresence:self'),
  ('driverSettlement:self')
) AS p(permission_key)
WHERE r.key = 'DRIVER';

-- 4) users 表新增 role_id，先允许 NULL，backfill 完再收紧
ALTER TABLE "users" ADD COLUMN "role_id" INTEGER;

-- 5) 用旧的 role enum 值 backfill：ADMIN -> OWNER，DRIVER -> DRIVER
UPDATE "users" u
SET "role_id" = r.id
FROM "roles" r
WHERE r.key = CASE WHEN u."role" = 'ADMIN' THEN 'OWNER' ELSE 'DRIVER' END;

-- 6) 收紧成 NOT NULL + 外键
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7) audit_logs.actor_role 从 enum 改成 TEXT（保留既有资料，只是型别改变——
--    以后新增角色不该反过来又要求这个栏位做一次 schema migration）
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" TYPE TEXT USING "actor_role"::text;

-- 8) 移除旧栏位跟旧 enum
ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "UserRole";
