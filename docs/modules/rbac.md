# Module 7: RBAC（Role-Based Access Control）

## 概念

把 Module 2 起就存在的「角色等于权限」（`requireRole("ADMIN"|"DRIVER")`）拆成两层：

- **Role（角色）存数据库**——`roles` / `role_permissions` 两张表，`User.roleId` 是必填外键
- **Permission Key（权限）固定写在代码里**——[`apps/backend/src/common/permissions.ts`](../../apps/backend/src/common/permissions.ts) 的 `PERMISSIONS` 常数，不是 DB 资料

这个设计刻意让「新增角色」变成纯资料操作：以后要加 Finance、Auditor、Customer Service 之类的角色，只需要写一份 migration 插入一笔 `Role` + 对应的 `RolePermission`，**不需要改任何业务逻辑、router 或 controller**——因为所有权限检查看的是 permission key（`booking:read` 这种字符串），不是角色名字。只有新增「全新的功能领域」（未来的 Module 8）才需要在 `permissions.ts` 补一个新的 `PERMISSIONS` 常数。

## 角色定案

现有 `ADMIN` 安全迁移为 `OWNER`（migration 里用 `role = 'ADMIN' → OWNER` 的 backfill，`DRIVER` 维持不变）：

| 角色 | 说明 |
|---|---|
| `OWNER` | 公司负责人，拥有所有权限，包含 Company Settings/Commission 设定 |
| `MANAGER` | 日常车队营运：Booking、Driver、Dispatch、GPS、Wallet、Collection、Settlement；Company Settings 只能看不能改 |
| `DISPATCHER` | 派车专员：Booking、Dispatch Center、查看 Driver 与 GPS，不能碰 Wallet/Settlement/Collection/Commission |
| `DRIVER` | 司机，只能查看/操作自己的工作、GPS、收入、代收款、结算纪录 |

## Permission Key 矩阵

19 个 key，一个功能领域一组 read/write（或唯一的 read），加上 Driver 自助用的 5 个 `*:self`：

| 权限 | OWNER | MANAGER | DISPATCHER | DRIVER |
|---|:-:|:-:|:-:|:-:|
| `booking:read` / `booking:write` | ✅ | ✅ | ✅ | — |
| `driver:read` | ✅ | ✅ | ✅ | — |
| `driver:write` | ✅ | ✅ | ❌ | — |
| `dispatch:read` | ✅ | ✅ | ✅ | — |
| `gps:read` | ✅ | ✅ | ✅ | — |
| `wallet:read` / `wallet:write` | ✅ | ✅ | ❌ | — |
| `settlement:read` / `settlement:write` | ✅ | ✅ | ❌ | — |
| `collection:read` / `collection:write` | ✅ | ✅ | ❌ | — |
| `companySettings:read` | ✅ | ✅ | ✅ | ✅ |
| `companySettings:write` | ✅ | ❌ | ❌ | ❌ |
| `driverJobs:self` / `driverWallet:self` / `driverCollection:self` / `driverPresence:self` / `driverSettlement:self` | — | — | — | ✅ |

> **Module 8 更新**：`companySettings:read` 从「只有 OWNER」放宽成「全部 4 个角色都能读」——Company Settings 的 General 分类（公司名称/时区/币别）跟 GPS 上传间隔这类前端要用到的设定，Manager/Dispatcher/Driver 都需要能读到才能正常显示，只是仍然不能改。`companySettings:write` 维持 OWNER only，详见 [company-settings.md](company-settings.md)。

**关键设计**：Dispatch Center 的 Quick Assign/Reassign 走的是 `bookings.routes.ts` 底下既有的 assign 端点（见 [dispatch-center.md](dispatch-center.md)），所以归在 `booking:write`，不是独立的 `dispatch:write`——这是 Dispatcher 需要 `booking:write` 而不是只有 `booking:read` 的原因。Dispatch Center 自己的三支 API（waiting-bookings/drivers/statistics）纯读取聚合，只需要 `dispatch:read`。

## Backend

- **`apps/backend/prisma/schema.prisma`**：`Role`（`id/key/name/description`）、`RolePermission`（`roleId/permissionKey`，`@@unique([roleId, permissionKey])`，`permissionKey` 不是 FK，只是字符串——Permission 本身不是 DB 实体）；`User.roleId` 必填外键；`AuditLog.actorRole` 从 Prisma enum 改成 `String?`（见下方风险说明）
- **`apps/backend/src/common/permissions.ts`**：`PERMISSIONS`/`ROLE_KEYS` 常数 + `DEFAULT_ROLE_PERMISSIONS`（migration/seed 共用的初始角色→权限对照表，跟本文件的矩阵保持一致）
- **`apps/backend/src/modules/auth/auth.middleware.ts`**：`requireAuth` 把 `Role`+`RolePermission` join 进 `req.authUser`（`role: {key, name}`、`permissions: string[]`）；`requirePermission(key)` 取代 `requireRole(role)`
- **13 个 router 文件**统一改成 `router.use(requireAuth)` + 每条路由各自 `requirePermission(...)`（read 用 GET，write 用 POST/PATCH/DELETE），不再用整个 router 一次性挡住的写法——这样「以后新增角色不用改 code」才是真的成立，不会因为剩下某个 router 是整块判断而漏掉细粒度控制
- **`drivers.service.ts`**：建立 Driver 登入帐号时改成查 `Role` table 拿 `roleId`（`key = "DRIVER"`），不再硬编码字符串
- 业务 service/controller 层完全没有改动——权限检查 100% 集中在 middleware，跟改造前的架构一致，只是判断依据从「角色名字相等」换成「permission 是否存在于 `req.authUser.permissions`」

## Database Migration

单一 migration（[`20260725000000_rbac_roles_permissions`](../../apps/backend/prisma/migrations/20260725000000_rbac_roles_permissions/migration.sql)），操作顺序：

1. 建 `roles` / `role_permissions` 两张表
2. 种入 4 个角色 + 各自的初始权限（这是「参考资料」，所有环境都需要存在，所以放在 migration 里跟 `prisma migrate deploy` 一起自动跑，不是 `seed.ts` 的职责）
3. `users` 新增 `role_id`（先允许 NULL）→ `UPDATE` backfill（`ADMIN→OWNER`，其余 `→DRIVER`）→ 收紧成 `NOT NULL` + 外键
4. `audit_logs.actor_role` 从 enum 转 `TEXT`（保留既有资料，只是型别改变）
5. 移除 `users.role` 旧栏位跟 `UserRole` 旧 enum

已在本地空数据库跟已有种子资料的数据库两种情境测过：空库跑完整 9 个 migration 全部成功；已有资料的库套用后 `admin→OWNER`、`driver01/driver02→DRIVER` backfill 正确，4 个角色跟对应的 `role_permissions` 笔数（OWNER 14、MANAGER 12、DISPATCHER 5、DRIVER 5）符合矩阵设计。

## Frontend

前端权限判断**只是 UX 层的显示/隐藏，不是安全边界**——真正的检查一律在 Backend 的 `requirePermission` middleware，这里只是让使用者不会点到会被 403 的东西：

- `types/auth.ts`：`AuthUser.role` 改成 `{key, name}`，新增 `permissions: PermissionKey[]`
- `common/permissions.ts`：跟后端同一份 Permission Key 定义的前端镜像（目前 monorepo 没有共用 packages，先各自维护一份）
- `modules/auth/usePermission.ts` / `PermissionGate.tsx`：`usePermission(key)` 回传布尔值；`<PermissionGate permission="wallet:write">` 包住只有对应权限才渲染的内容
- `modules/auth/RequireAuth.tsx`：`portal: "admin"|"driver"` 做粗粒度切换（决定套 `AppLayout` 还是 `DriverLayout`）；`modules/auth/RequirePermission.tsx` 做页面级细粒度权限检查（`App.tsx` 每条 Route 各自指定需要的 permission）
- `layouts/AppLayout.tsx`：导览列项目依 `user.permissions` 过滤，Dispatcher 登入看不到 Wallet/Settlement/Collection
- 各页面操作按钮（新增/编辑/停用 Driver、Verify/Void Collection、Void Settlement、Confirm Settlement、Manual Adjustment）用 `PermissionGate` 包住对应的 write permission

## 已知限制

- Dispatch Center 的 Quick Assign 依赖 `booking:write`，不是独立权限——如果之后要「Dispatcher 能看 Booking 但不能自己建/改 Booking，只能指派」这种更细的权限，现在的设计做不到，需要另外把 assign 从 `booking:write` 独立出一个权限
- `AuditLog.actorRole` 从 Prisma enum 改成纯字符串，失去数据库层的型别约束——这是必要的取舍，理由见下方
- 不做 Role/Permission 的可视化管理页面，新增角色目前只能透过写 migration 完成
- 前端权限隐藏纯粹是 UX，不能当作安全边界

## 为什么 `AuditLog.actorRole` 要从 enum 改成字符串

如果 `actorRole` 还是 Prisma enum，新增角色时还是得跑一次 schema migration 才能让 enum 多一个合法值，等于「新增角色不需要改 code」这句话就不成立了。改成字符串后失去的只是「数据库帮你挡打错字」这一层保护，不影响任何现有查询或业务逻辑——这个栏位本来就只是操作纪录的快照，不参与任何业务判断。
