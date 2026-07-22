# Module 8: Company Settings

## 概念

在这之前，好几个数字散落在程式码里写死：GPS 上传间隔、Connection Lost/Offline 门槛、Collection 上传档案大小上限、Booking 的预设抽成……这个 Module 把它们全部集中到同一张单例设定表（`company_settings`，Module 3 就有，这次扩充栏位），Backend 各模块统一从这里读，不再各自硬编码常数。

只有 `OWNER` 能修改；`MANAGER`、`DISPATCHER`、`DRIVER` 都能读，但不能改（见 [rbac.md](rbac.md) 的权限矩阵——这次连带把 `companySettings:read` 从「只有 OWNER」放宽给全部 4 个角色，因为 Driver 端的 GPS 上传间隔、各角色看到的币别显示都要读这张表）。

## Database Schema

`company_settings` 单例表（只会有一笔资料，`getCompanySettings()` 第一次读取时如果整张表是空的会自动建一笔保底默认值）。Module 8 新增的栏位：

| 分类 | 栏位 | 型别 | 默认值 |
|---|---|---|---|
| General | `companyName` | String | `""` |
| General | `timezone` | String | `Asia/Kuala_Lumpur` |
| General | `currency` | String | `RM` |
| Booking | `defaultCommissionType` / `defaultCommissionValue` | enum / Int | `PERCENTAGE` / `15`（Module 3 既有栏位，沿用不变） |
| Booking | `allowManualLegAllocation` | Boolean | `true` |
| Booking | `requireDriverAccept` | Boolean | `true` |
| GPS | `gpsUploadIntervalSeconds` | Int | `5` |
| GPS | `connectionLostTimeoutSeconds` | Int | `30` |
| GPS | `offlineTimeoutSeconds` | Int | `120` |
| Settlement | `defaultSettlementTime` | String（`HH:mm`） | `21:00` |
| Settlement | `settlementTimezone` | String | `Asia/Kuala_Lumpur` |
| Collection | `collectionVerificationRequired` | Boolean | `true` |
| Collection | `maxUploadFileSizeMb` | Int | `5` |

## Migration

[`20260728000000_company_settings_expansion`](../../apps/backend/prisma/migrations/20260728000000_company_settings_expansion/migration.sql)：

1. `ALTER TABLE company_settings ADD COLUMN ...`（12 个新栏位，全部带 `DEFAULT`，Postgres 会自动帮既有那一笔资料补上默认值，不需要额外的 `UPDATE` backfill）
2. `INSERT INTO role_permissions` 补上 `companySettings:read` 给 `MANAGER`/`DISPATCHER`/`DRIVER`（`OWNER` 已经有，不重复插入；纯资料操作，不需要改任何 router/controller/service，跟 Module 7 的 RBAC 设计一致）

已在本地空数据库（10 个 migration 全部套用）跟已有资料的 dev 数据库两种情境测过，都成功。

## Backend API

`GET /api/admin/company-settings` — 需要 `companySettings:read`（4 个角色都有）
`PATCH /api/admin/company-settings` — 需要 `companySettings:write`（只有 `OWNER`）

Validation（`companySettings.controller.ts` 的 zod schema）：
- `defaultSettlementTime` 必须符合 `HH:mm` 格式
- `gpsUploadIntervalSeconds` 1–300、`connectionLostTimeoutSeconds`/`offlineTimeoutSeconds` 1–3600、`maxUploadFileSizeMb` 1–20
- **合并后的最终值**一定要满足 `gpsUploadIntervalSeconds < connectionLostTimeoutSeconds < offlineTimeoutSeconds`（`companySettings.service.ts` 的 `assertConsistentThresholds`）——PATCH 允许只传部分栏位，所以这个检查用「这次没传的栏位就沿用现有值」合并后再验证，不能只看这次请求里有没有传，否则可能只改一个栏位就意外打破跟另一个没传的既有栏位之间的关系

Audit Log：每次 PATCH 都写一笔 `COMPANY_SETTINGS_UPDATE`，`beforeData`/`afterData` 是完整的设定快照（不只是有改的栏位），`actorUserId`/`actorRole` 记录修改人，`createdAt` 自动记录时间——修改人/时间/修改前/修改后全部齐全，不需要额外开发。

## Frontend

- `/company-settings`（导览列最后一项，`companySettings:read` 权限过滤——4 个角色都看得到这个连结）
- `CompanySettingsPage`：General/Booking/GPS/Settlement/Collection 五个 `Card` 分区表单。`OWNER` 看到可编辑表单 + 保存按钮；其余角色看到同一份表单但整个 `Form` 用 `disabled` 包住 + 一条「只有 Owner 可以修改」的提示，不是另外做一个唯读页面
- `CompanySettingsProvider`（`main.tsx` 挂在 `AuthProvider` 底下）：登入后统一抓一次 Company Settings，提供给整个 App 使用；`lib/money.ts` 的 `formatCents` 不再写死 `RM`，改成读 `CompanySettingsProvider` 设定的 `currencyPrefix`；`DriverPresenceToggle` 的 GPS 上传 `setInterval` 改读 `gpsUploadIntervalSeconds`

## 已移除的 Hard Code

| 原本写死的位置 | 数值 | 现在的来源 |
|---|---|---|
| `apps/frontend/.../DriverPresenceToggle.tsx` 的 `PING_INTERVAL_MS` | 5000ms | `companySettings.gpsUploadIntervalSeconds` |
| `apps/backend/.../gps.service.ts` 的 `CONNECTION_LOST_THRESHOLD_SECONDS` | 30 | `companySettings.connectionLostTimeoutSeconds`（透过新增的 `getPresenceThresholds()` 读取，`gps.service.ts`/`dispatch.service.ts` 两处调用都改传这个值） |
| `apps/backend/.../gps.service.ts` 的 `AUTO_OFFLINE_THRESHOLD_SECONDS` | 120 | `companySettings.offlineTimeoutSeconds` |
| `apps/backend/.../upload.ts` 的 `MAX_FILE_SIZE_BYTES` | 5MB | `companySettings.maxUploadFileSizeMb`（multer 本身的 `limits.fileSize` 改成 20MB 的硬上限，真正生效的可调上限在档案落盘后另外检查一次，见下方已知限制） |
| `apps/frontend/.../lib/money.ts` 的 `RM` 前缀 | `"RM "` 字面量 | `companySettings.currency` |

`CONNECTION_LOST_THRESHOLD_SECONDS`/`AUTO_OFFLINE_THRESHOLD_SECONDS` 这两个常数本身**没有被删除**，仍然 export 在 `gps.service.ts`——现在的角色是「读不到设定时的保险丝默认值」，`computePresenceStatus` 纯函数新增了两个可选参数（不传就退回这两个常数），这样既有的单元测试完全不用改，也维持了原本「纯函数、方便测试」的设计。

## 已知限制

- **`allowManualLegAllocation`、`requireDriverAccept`、`collectionVerificationRequired` 目前只存资料，没有真的接进业务逻辑**：这三个是原本就有的固定行为（手动分配 Leg 一直都可以、Driver 一直都要 Accept、Collection 一直都要 Verified 才能结算），不是「目前写死的参数」，而是写死在状态机/验证逻辑结构里的行为——照使用者的指示「不要修改现有业务逻辑」，这次先把这些开关做成可读可写的设定存起来，但不接进实际的 enforcement，避免这个 Module 意外变成一次业务逻辑重构。之后如果要让这些开关真的生效，需要另外修改 `legs.service.ts` 的 allocation 校验、`legTransition.ts` 的状态机、`collection.service.ts`/`settlement.service.ts` 的结算过滤条件。
- **`defaultSettlementTime`/`settlementTimezone` 目前没有任何排程会用到**：Daily Settlement 现在是手动在 `/settlements/daily` 页面触发，没有背景 Cron。这两个栏位是为了「以后要做自动排程结算」预留的设定，现在存进去、可以读写，但不会自动触发任何结算动作。
- **Max Upload File Size 是「软上限」，背后有一个 20MB 的硬上限**：multer 的 `limits.fileSize` 是在 router 注册时（模块载入时）就固定死的，没办法每个请求动态读一次 DB，所以设成 20MB 的硬上限防滥用；真正会被 Company Settings 调整的档案大小上限，是落盘、算完 magic number 之后另外检查一次——超过设定值会把刚存的档案删掉、回 400。也因为这样，`maxUploadFileSizeMb` 的 Validation 上限就是 20。
- **前端权限隐藏（唯读表单）不是安全边界**：跟 Module 7 的原则一致，真正的权限检查在 Backend 的 `requirePermission(COMPANY_SETTINGS_WRITE)`，已经用直接打 API 的方式验证过 Manager 帐号会被 403 挡下来。
- **不做 Setting 变更历史的可视化页面**：Audit Log 有完整记录（`entityType: "CompanySettings"`），但目前没有专门的页面把这些记录列出来给使用者看，要查只能直接查 `audit_logs` 表。

## 测试

- [`companySettings.integration.test.ts`](../../apps/backend/src/modules/companySettings/companySettings.integration.test.ts)：General/Collection 栏位更新正确持久化、GPS 阈值一致性校验（`gpsUploadInterval < connectionLost < offline`）在「一次全部传」跟「只传一个栏位、用既有值合并校验」两种情境下都正确挡下不合法的组合
- [`gps.presence.test.ts`](../../apps/backend/src/modules/gps/gps.presence.test.ts)：新增两个测试验证 `computePresenceStatus` 接受自定义阈值参数时，会真的按照传入的值判断（不是仍然套用默认的 30/120 秒）
- 既有的 [`gps.integration.test.ts`](../../apps/backend/src/modules/gps/gps.integration.test.ts)、[`dispatch.integration.test.ts`](../../apps/backend/src/modules/dispatch/dispatch.integration.test.ts) 不用改就能继续通过——因为 dev 数据库的 Company Settings 默认值跟原本写死的常数完全一致
- 浏览器手动验证：`OWNER`（`admin`）登入 `/company-settings` 看到可编辑表单，修改 Company Name 存档后 `company_settings` 表跟 `audit_logs` 都正确更新（`actorRole: OWNER`、`beforeData`/`afterData` 完整）；`MANAGER`（`manager01`）登入同一个页面看到「只有 Owner 可以修改」提示、表单唯读、没有保存按钮；直接对 API 发 `PATCH` 请求（绕过前端）用 Manager 的 session 打，Backend 正确回 403
