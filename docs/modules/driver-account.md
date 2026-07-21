# Module 2: Driver Account & Authentication

## 概念

> Module 7（RBAC）之后，角色已经从 `ADMIN`/`DRIVER` 扩充成 `OWNER`/`MANAGER`/`DISPATCHER`/`DRIVER`，详见 [rbac.md](rbac.md)。本文件下方仍保留「ADMIN」字样的地方，指的是 Module 7 之前设计的「管理端角色」概念，实际现在对应 OWNER/MANAGER/DISPATCHER 三个角色的其中一个，依各自的 Permission 决定能不能用。

客户不开帐号、不登入系统。

登入帐号（`User`）跟司机业务资料（`Driver`）分开存，用 `Driver.userId` 关联：
- `User`：username、passwordHash（bcrypt）、roleId（外键，指向 `roles` 表）、status（ACTIVE|DISABLED）
- `Driver`：业务资料（name、phone、vehiclePlateNumber、remark），沿用 Module 1 就有的表，只是加了栏位，没有另外建一套
- Admin 帐号是纯 `User`，没有对应的 `Driver` row
- Driver 是否能登入，看 `Driver.status`（沿用既有栏位，不另外加一个重复的开关）；`User.status` 是独立的帐号层级停用开关（Admin/Driver 都适用，目前只有 Driver Management 页面用到它作为「启用/停用」）

## 认证方式

httpOnly cookie session（express-session + connect-pg-simple，session 存在 Postgres 里，不需要额外服务）。密码用 bcrypt 加密（10 轮）。

每次受保护请求都会从 DB 重新读一次当前用户和（如果是 Driver）关联的 Driver 状态，确认还是 ACTIVE 才放行——帐号被停用后，就算 session 还没过期，下一个请求就会立刻被拒绝，不用等重新登入才生效。

`requireAuth` middleware 验证登入；`requirePermission(key)` 做权限限制（Module 7 起取代原本的 `requireRole`，详见 [rbac.md](rbac.md)）。前端对应 `RequireAuth` 元件依角色导去不同 Portal：管理端角色（OWNER/MANAGER/DISPATCHER）→ Booking 列表，DRIVER → 我的工作页；进错 Portal 或没有对应 Permission 的路由会被导回自己该去的地方。

## API

- `POST /api/auth/login` — `{username, password}` → 帐号资料
- `POST /api/auth/logout`
- `GET /api/auth/me` — 目前登入者

- `GET /api/drivers` — 列表（含 username、是否有未完成 Leg），需要 `driver:read`
- `POST /api/drivers` — 新增（`username`/`password` 可选，不填代表这个 Driver 暂时没有登入帐号）
- `PATCH /api/drivers/:id` — 改业务资料（不含 username/password）
- `POST /api/drivers/:id/status` — 启用/停用
- `POST /api/drivers/:id/reset-password` — 重设密码

- `GET /api/driver/legs` — 目前登入 Driver 自己的所有 Leg，需要 `driverJobs:self`
- `POST /api/driver/legs/:legId/accept`
- `POST /api/driver/legs/:legId/reject` — `{reason}`
- `POST /api/driver/legs/:legId/arriving`
- `POST /api/driver/legs/:legId/on-board`
- `POST /api/driver/legs/:legId/complete`

以上 Driver 动作都会先验证这个 Leg 的 `driverId` 是不是自己，不是就当作不存在（404，不透露归属给别人）。

## Leg 状态机（取代 Module 1 的 PENDING/IN_PROGRESS/COMPLETED 二段式）

```
PENDING（未指派）
  → ASSIGNED（Admin 指派/重新指派）
    → ACCEPTED（Driver 接受）
      → DRIVER_ARRIVING（Driver 标记前往中）
        → PASSENGER_ON_BOARD（Driver 标记乘客已上车）
          → COMPLETED（Driver 标记完成，终止态）
    → REJECTED（Driver 拒绝，需填原因；终止态，但会一直显示在 Admin 视图直到被重新指派）
（PENDING/ASSIGNED/ACCEPTED/DRIVER_ARRIVING/PASSENGER_ON_BOARD/REJECTED）→ CANCELLED（Admin 取消，终止态）
```

Admin 只能「指派/重新指派」「取消」，不能直接把 Leg 标记成任何进行中/完成的状态——这些一律由 Driver 在自己的工作页操作。重新指派（包括对着 REJECTED 的 Leg 重新指派给别人）会把状态打回 `ASSIGNED`，并清空之前的接受/前往/上车/拒绝纪录，让新 Driver 从头开始。

Booking 的状态推导规则（[bookings.status.ts](../../apps/backend/src/modules/bookings/bookings.status.ts)）也跟着更新：`ACTIVE_LEG_STATUSES` 现在是 `ASSIGNED/ACCEPTED/DRIVER_ARRIVING/PASSENGER_ON_BOARD/COMPLETED`，`REJECTED` 刻意不算在内（被拒绝的 Leg 要让 Booking 退回「需要处理」，不能卡住或误判成有进度）。

## 防冲突设计

所有状态转换（assign / accept / reject / arriving / on-board / complete）都用同一个 [legTransition.ts](../../apps/backend/src/modules/bookings/legTransition.ts) 里的 `applyLegTransition`：一次 `UPDATE ... WHERE id=? AND status IN (期望的状态)` 完成检查+更新。改动笔数不是 1，就代表状态已经被别人改过（比如两个 Admin 同时指派、Driver 重复 Accept），直接报错，不会用「先读再写」的方式留下竞态漏洞。

所有重要操作（登入登出、Driver 建立/编辑/停用/重设密码、Leg 每一次状态变化）都写进 `audit_logs`，记录操作人（`actorUserId`）、动作、对象、时间。

## Frontend

- `/login` — 统一登入页，依角色登入后导去对应首页
- `/drivers`（ADMIN）— Driver Management：列表（含未完成 Leg 指示）、新增、编辑、启用/停用、重设密码
- `/driver/jobs`（DRIVER）— 我的工作：待接受 / 即将进行 / 进行中 / 已完成 / 已拒绝或已取消 五个分类，Accept / Reject（填原因）/ Driver Arriving / Passenger On Board / Mark as Completed
- Booking 详情页的 Leg 列表现在显示各阶段时间戳、拒绝原因；Admin 只剩「指派/重新指派」「取消」「删除（仅限 PENDING）」

## 测试帐号

见根目录 [README.md](../../README.md)，仅限本地开发环境使用。

## 已知限制

- Driver 只有一个「未完成 Leg」布尔指示，没有工作量/排班总览
- Reassign 目前没有通知机制，Driver 要重新整理工作页才会看到新指派或被取消——本阶段刻意不做 Notification
- 没有「忘记密码」自助流程，密码只能由 Admin 重设
- 自动化测试目前只覆盖状态推导、密码加密等纯逻辑；Leg 状态机的并发防护（`applyLegTransition`）已经用手动多帐号测试验证过，但还没有写自动化的并发测试
- Username 建立后不能修改（避免额外的唯一性冲突处理），需要改用户名要重建帐号
