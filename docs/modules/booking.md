# Module 1: Booking

## 概念

一张 `Booking` 以 `Girl`（被派出去服务的人）为主体，不记录付钱客户的身份，只用地址定位。Booking 包含一到多个 `Leg`（车程），Leg 之间用 `sequence` 排序。每个 Leg 可以指派不同的 `Driver`。Booking **不**直接绑定 Driver，Driver 只绑定在 Leg 上。

Driver 表目前是最小版本（id/name/phone/status），只为了让 Leg 能指派司机；完整的司机管理（执照、证件到期等）是未来独立的 Module，届时只会加栏位，不会动到这里的关联结构。

业务上「起点」通常是固定不变的地方（车手都知道），不需要每次记录；真正会变的只有「带去的地址」。所以 `Leg.pickupLocation` / `dropoffLocation` 都是可选栏位：去程通常只填 `dropoffLocation`（要带去的地址），回程通常只填 `pickupLocation`（同一个地址，回程终点是家，不用记）。

## Database Schema

```
Driver
  id, name, phone?, status(ACTIVE|INACTIVE), createdAt, updatedAt

Booking
  id, girlName, notes?
  totalAmountCents, platformCommissionType, platformCommissionValue,
  platformAmountCents, driverPoolAmountCents   -- 见 commission-wallet-settlement.md
  status(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)  -- 自动推导，见下
  createdAt, updatedAt

Leg
  id, bookingId, sequence
  pickupLocation?, dropoffLocation?, scheduledAt?, notes?
  earningAllocationCents?   -- 见 commission-wallet-settlement.md
  driverId?  -- 可为空 = 未指派
  status(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)
  createdAt, updatedAt
```

> Module 3（Commission/Wallet/Settlement）上线后，原本的 `carFee`（车费，单位是 ringgit）改成 `totalAmountCents`（Booking 总价，单位是 cents），概念上是同一件事只是单位跟栏位名称改了，细节见 [commission-wallet-settlement.md](./commission-wallet-settlement.md)。

## Booking Status Flow

Booking 的 status 不是手动设定的字段，是每次 Leg 状态变动时，由 `bookings.status.ts` 里的纯函数根据当下所有 Leg 重新推算出来，并写回 DB（方便列表查询/筛选，不用每次都 join 计算）。

推导规则（`deriveBookingStatus`）：
1. 若 Booking 当前已是 `CANCELLED`（人工取消） → 保持 `CANCELLED`，不重算
2. 排除掉 `status = CANCELLED` 的 Leg，得到 activeLegs
3. 若原本有 Leg，但 activeLegs 为空（代表全部 Leg 都被取消了）→ `CANCELLED`
4. 若完全没有 Leg → `PENDING`
5. 若 activeLegs 全部是 `COMPLETED` → `COMPLETED`
6. 若 activeLegs 中有任一 `IN_PROGRESS` 或 `COMPLETED` → `IN_PROGRESS`
7. 其余 → `PENDING`

人工取消整张 Booking（`POST /cancel`）会把 Booking.status 直接设为 `CANCELLED`，并把还没结束的 Leg（`PENDING`/`IN_PROGRESS`）一并设为 `CANCELLED`；已经 `COMPLETED` 的 Leg 不受影响。

## Leg Status Flow

> Module 2（Driver Account）上线后，Leg 状态机改成 Driver 自己在工作页操作接受/前往/上车/完成，Admin 只负责指派/重新指派/取消，细节见 [driver-account.md](./driver-account.md)。这里列出的 `PENDING → IN_PROGRESS → COMPLETED` 是 Module 1 当时的简化版，已经不是目前系统的实际行为。

## API

见开发过程中的 `bookings.routes.ts` / `drivers.routes.ts` 为准，设计摘要：

- `GET /api/bookings` — 列表，支持 `status`、`search`（比对 girlName）、`page`、`pageSize`
- `GET /api/bookings/:id` — 详情，含 legs（每个 leg 附带指派的 driver 基本信息）
- `POST /api/bookings` — 建立，可同时带 `legs: []` 一起建
- `PATCH /api/bookings/:id` — 改 `girlName` / `notes` / 总价与抽成（已有 Completed Leg 或 Wallet Transaction 时不可改总价与抽成，见 [commission-wallet-settlement.md](./commission-wallet-settlement.md)）
- `POST /api/bookings/:id/cancel` — 取消整张 Booking（级联取消未完成的 Leg）
- `POST /api/bookings/:id/legs` — 新增 Leg（sequence 自动 = 目前最大值 + 1）；Booking 为 `CANCELLED` 时不可新增
- `PATCH /api/bookings/:id/legs/:legId` — 改 Leg 资料，仅限 leg 尚未 `COMPLETED`/`CANCELLED`
- `POST /api/bookings/:id/legs/:legId/assign` — 指派/重新指派 driver（细节见 [driver-account.md](./driver-account.md)）
- `POST /api/bookings/:id/legs/:legId/cancel` — 取消单一 Leg
- `DELETE /api/bookings/:id/legs/:legId` — 仅限 `PENDING` 状态，直接删除（尚未发生的事，不需要保留历史）
- `GET /api/drivers?status=` — 列表（给指派用的下拉选单）
- `POST /api/drivers` — 快速新增司机（name, phone?）

不提供 Booking 的物理删除 API，只有 cancel（保留历史记录）。

## Frontend

- `/` Booking 列表页：状态筛选、关键字搜索（Girl 姓名）、每笔显示 Leg 进度（如 2/3 已完成）、Booking Total
- `/bookings/:id` Booking 详情页：Girl 姓名、状态、总价与抽成拆解（Platform Amount / Driver Pool / Allocated / Remaining）、取消按钮、Leg 列表（依 sequence 排序，各自的指派/取消操作、司机收入设定）、新增 Leg
- 指派司机走 Modal，下拉选现有 Driver，附「快速新增司机」
- 引入 `react-router-dom` 做多页导航、`@tanstack/react-query` 做资料请求与 mutation 后自动 refetch（后续每个 Module 都会重用这套基础设施）

## 智能识别贴文（新建 Booking）

派单信息平常是从聊天软件复制过来的固定格式文字，例如：

```
📋Date: 20/7
Girl: Yoyo
Pick up: 8.45pm
Time: 9 hrs
Collect: 1060
Address:
====================
Aera Service Residency Apartment
====================
Car fee: 130
```

新建 Booking 的 Modal 顶部有一个贴文字用的输入框，贴上后点「识别并填入」，由 [parseBookingText.ts](../../apps/frontend/src/modules/bookings/parseBookingText.ts) 这个纯函数解析：

- `Girl:` → Girl 姓名
- `Date:` + `Pick up:` → 去程 Leg 的 `scheduledAt`（年份用当下年份）
- `Time: N hrs` → 回程 Leg 的 `scheduledAt` = 去程时间 + N 小时
- `Address:` 与两条 `====` 分隔线之间的文字 → 去程填 `dropoffLocation`，回程填 `pickupLocation`（同一个地址，方向相反）
- `Collect:` → 拼进备注
- `Car fee:` → Booking Total（`totalAmountCents`）

识别结果只是预填表单，仍可手动修改后再送出；抓不到的栏位就留空，不会因为格式跟范例不完全一致而报错。目前只用在新建 Booking，还没接到「新增 Leg」的流程。

## 目前完成状态

用户已实际测试过以下流程，确认没有问题：

- Booking / Leg / Driver 的建立、查看、编辑
- Booking status 依 Leg 自动推导，取消会级联取消未完成的 Leg
- 指派司机（含 Modal 内快速新增司机，不含登入帐号）
- Leg 的指派/重新指派/取消/删除操作与对应的业务规则限制
- 智能识别贴文自动填入新建 Booking 表单
- Leg 起点/终点可留空，符合「起点固定不用记」的业务实际情况

Module 2 上线后新增：Admin/Driver 登入权限、Driver 在自己的工作页处理 Leg（详见 [driver-account.md](./driver-account.md)）。

Module 3 上线后新增：Booking 总价与抽成计算、Leg 收入分配、Driver Wallet、Daily Settlement（详见 [commission-wallet-settlement.md](./commission-wallet-settlement.md)）。

## 已知限制

- 智能识别贴文只接在「新建 Booking」，还没接到「新增 Leg」（例如已有 Booking 想再贴一段追加行程）
- Collect 金额只是备注文字，没有结构化栏位/统计功能
- 客户身份完全不记录（只用地址定位），如果以后需要追踪客户历史会是另一个 Module
- 其余（Driver 完整资料、登入权限、自动化测试、Commission/Wallet/Settlement）见 [driver-account.md](./driver-account.md) 和 [commission-wallet-settlement.md](./commission-wallet-settlement.md) 的已知限制
