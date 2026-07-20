# Module 6: Dispatch Center（派车中心）

## 概念

Dispatch Center 是给 Dispatcher（派单员）每天用的单一工作画面：左边看所有等待处理的 Booking，右边看所有 Driver 的状态跟工作量，点一下 Booking、点一下 Driver 就能直接指派，不用开 Modal、不用跳转到 Booking 详情页。

**这个 Module 刻意设计成纯读取聚合层**：它不新增任何写入逻辑，也不改动任何已完成 Module 的档案（Booking/Leg、Driver、Wallet、Settlement、Collection、GPS 的 schema 跟 service 完全没有动）。唯一的写入动作——Assign/Reassign——直接复用 Module 1/2 早就有的 `assignDriver` API（`POST /api/bookings/:id/legs/:legId/assign`），Dispatch Center 前端只是换一个更快的入口去呼叫同一个既有 API。

## Dispatcher 的权限边界

目前系统只有 `ADMIN`/`DRIVER` 两种登入角色（Module 2 定的），没有独立的「Dispatcher」帐号类型——新增一个角色需要改动 Module 2 的 auth 模块，不在这次的范围内。这里的做法是：Dispatch Center 页面本身**只提供 Assign/Reassign/View**，不放任何 Wallet/Settlement/Collection/Commission 的操作入口，实际权限还是走既有的 `requireRole("ADMIN")`。如果之后真的要让非 Admin 的人专职做派车，需要另外开一个 Module 处理角色/权限，这里先不做。

## Waiting Booking（左边）

数据来源是 `Leg`，不是 `Booking`——因为指派动作本来就是针对 Leg 做的，一张 Booking 可能有多个 Leg，各自需要独立追踪。

- **Filter**：Waiting（`PENDING`+`REJECTED`）、Assigned（`ASSIGNED`）、Accepted（`ACCEPTED`）、In Progress（`DRIVER_ARRIVING`+`PASSENGER_ON_BOARD`）；不选就显示这五种状态的全部（`COMPLETED`/`CANCELLED` 一律不出现在这个列表）。
- `REJECTED` 刻意跟 `PENDING` 一起算进 Waiting——两者对 Dispatcher 来说都是「需要（重新）指派一个 Driver」，被拒绝的 Leg 不会消失在列表里，Dispatcher 马上就能看到、马上能重新派车。
- **Priority**：`Booking`/`Leg` 目前没有这个栏位（Module 1 没有设计这个概念，这次也刻意不去改 Booking 的 schema），改用「这张 Booking 建立多久了还没派到车」当替代讯号——`<10` 分钟 `NORMAL`、`10–30` 分钟 `HIGH`、`≥30` 分钟 `URGENT`。这是即时算出来的，不是存在 DB 里的栏位。
- **Search**：比对 Booking ID（精确）或 Girl 姓名（模糊，不分大小写）。

## Driver List（右边）

每位 ACTIVE 状态的 Driver 显示：

- Name / Phone / Vehicle Plate Number
- **GPS 状态**（`ONLINE`/`OFFLINE`/`CONNECTION_LOST`）——直接复用 [gps.service.ts](../../apps/backend/src/modules/gps/gps.service.ts) 导出的 `computePresenceStatus` 纯函数，但传 `activeLegStatus: null`，所以这里显示的**永远是单纯的 GPS 状态**，不会像 GPS Dashboard（Module 5）那样被目前的 Leg 状态覆盖——Dispatch Center 把「GPS 好不好」跟「工作量多少」分成两个独立栏位显示，这是刻意的设计决定。
- **Workload**：
  - `Current Jobs`：目前手上未完成的 Leg 数（`ASSIGNED`/`ACCEPTED`/`DRIVER_ARRIVING`/`PASSENGER_ON_BOARD`，复用 Module 2 既有的 `UNFINISHED_LEG_STATUSES`）
  - `Pending Jobs`：其中还没被接受的（`ASSIGNED`）——这是「需要 Dispatcher 特别注意」的子集，指派出去了但司机还没确认
  - `Completed Today`：今天（本地日历日）已完成的 Leg 数
  - `Current Status`：`BUSY`（Current Jobs > 0）或 `IDLE`——Dispatcher 一眼就知道谁最空闲
- **Filter**：Online / Offline / Connection Lost（比对 GPS 状态）、Busy / Idle（比对 Workload 状态），二选一套用同一个 filter 值。
- **Search**：比对姓名或电话（模糊，不分大小写）。

## Quick Assign / Quick Reassign

点一下左边的 Booking（Leg）列表项，右边马上出现「正在指派：...」提示，每一位 Driver 卡片右侧出现 Assign 按钮；再点一下某位 Driver 就直接送出指派，不用另开视窗。同一支 API（`assignDriver`）本来就同时处理「第一次指派」跟「重新指派」（[legs.service.ts](../../apps/backend/src/modules/bookings/legs.service.ts) 的 `REASSIGNABLE_STATUSES` 早就包含 `PENDING`/`ASSIGNED`/`ACCEPTED`/`DRIVER_ARRIVING`/`PASSENGER_ON_BOARD`/`REJECTED`），所以 Quick Reassign（Driver Reject 之后重新派另一位）不需要任何新逻辑，选到状态是 `REJECTED` 的 Leg 时一样直接可以点其他 Driver 重派。

## Statistics（页面最上方）

`GET /api/admin/dispatch/statistics`：Waiting Booking / Assigned / In Progress / Completed Today / Online Driver / Offline Driver，全部用 `count()`/`groupBy` 聚合查询算，不把整批资料捞出来数。

Online/Offline Driver 这两个数字刻意直接读 `Driver.isOnline` 这个旗标做快速 count，不逐笔重新计算 presence（100+ Driver 规模下的效能考量）；极少数「已经超过 GPS 模块的 120 秒自动离线门槛、但还没被任何查询触发自愈写回」的 Driver 可能短暂被算成 Online，这跟 GPS 模块本身「正确性不依赖自愈有没有执行」的设计是一致的取舍——只要有人打开 Driver List 或 GPS Dashboard，这个数字就会自动跟着修正。

## API

`GET /api/admin/dispatch/waiting-bookings?filter=&search=`
`GET /api/admin/dispatch/drivers?filter=&search=`
`GET /api/admin/dispatch/statistics`

三支都是 ADMIN only、纯读取，[dispatch.service.ts](../../apps/backend/src/modules/dispatch/dispatch.service.ts) 里完全没有任何 `create`/`update`/`delete`。Assign/Reassign 走既有的 `POST /api/bookings/:id/legs/:legId/assign`，不在这个模块底下。

## Performance

- 三支 API 各自独立用 React Query 轮询，**5 秒一次**（跟 GPS 模块同一个节奏），不是「每秒重新载入整个画面」。
- Waiting Booking 列表查询加了 `take: 500` 上限；Driver List 用 `groupBy` 一次性算出所有 Driver 的工作量（3 个 groupBy 查询，不是每个 Driver 各自查一次，避免 100+ Driver 时的 N+1 问题）。
- Assign/Reassign 成功后只 invalidate `["dispatch"]` 跟 `["bookings"]` 这两组 Query Key，不强制整页重新整理。

## Frontend

`/dispatch`（Admin 专用，导览列第一个项目）：`DispatchCenterPage` 顶部 6 个 Statistic 卡片，左右两个 `Card`——`WaitingBookingsPanel`（Filter Segmented + Search + 可点选列表）、`DriverListPanel`（Filter Select + Search + Driver 卡片列表，选到 Booking 后才出现 Assign 按钮）。

## 测试

[dispatch.integration.test.ts](../../apps/backend/src/modules/dispatch/dispatch.integration.test.ts) 用真实 Postgres 覆盖：Waiting 列表正确排除 Completed/Cancelled、各 Filter 精确对应的状态组合、Priority 依等待时间正确分级（Normal/High/Urgent 边界）、Search 比对 Booking ID 跟姓名、Driver Workload 三个数字（Current/Pending/Completed Today）计算正确、**GPS 状态跟 Leg 状态确实是分开算的**（同一位 Driver 在 GPS Dashboard 会显示 Leg 状态、但 Dispatch Center 只显示纯 GPS 状态）、Busy/Idle Filter、Driver 姓名/电话搜索、Statistics 聚合数字正确。

浏览器手动验证：建立两笔待派车 Booking → Dispatch Center 正确显示 Statistics/Waiting 列表/Driver 列表（含即时 GPS 状态）→ 点选 Booking 后右边出现指派入口、点 Driver 直接指派成功，Statistics 跟两边列表同步更新（Waiting Booking 1→0 相应减少，Assigned+1，该 Driver 变 BUSY）→ 让 Driver Reject 该 Leg → Dispatch Center 正确把它退回 Waiting 列表并显示拒绝原因 → 直接点选、改指派给另一位 Driver，Quick Reassign 全程不用离开这个页面，全部验证通过。

## 已知限制

- Priority 是「等待时间」的替代讯号，不是真正可以手动设定的栏位；如果之后要让 Dispatcher 手动调整优先级，需要在 Booking 加一个真正的 `priority` 栏位（这会需要修改 Module 1 的 schema）
- 没有真正的「Dispatcher」角色，目前只能用 ADMIN 帐号使用这个页面
- 没有地图，Driver 位置只用文字座标显示（跟 GPS 模块的第一版范围一致）
- Waiting Booking 列表有 500 笔上限，超过这个数字的最旧项目不会显示；真的到这个规模时需要加分页
