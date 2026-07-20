# Module 5: GPS Live Tracking & Driver Online Status

## 概念

Driver 登入后可以自己 Go Online / Go Offline；上线期间前端每 5 秒上传一次目前位置（座标、速度、方向、电量，若装置提供）。Admin 有一个 Dashboard（List View，第一版不做地图）能即时看到所有在线 Driver 的位置跟状态；Booking Detail 页面也能看到目前负责这个 Leg 的 Driver 的实时状态。

**GPS 完全独立于 Booking**：上传失败、Driver 忘记上线、定位权限被拒——这些都不会、也不能影响 Leg/Booking 的任何操作。整个模块刻意设计成「读的时候才计算状态」，不会有任何背景 Job/Cron 去改动 Booking 或 Wallet 的资料。

## 资料模型

- `Driver.isOnline` / `Driver.onlineSince`：Driver 自己按 Go Online/Go Offline 时设的旗标，不代表最终显示给 Admin 的状态（见下方 Presence 计算）。
- `DriverLocation`：**只存最新一笔**，用 `driverId` 当主键，每次上传直接覆盖（`upsert`）。第一版明确不需要轨迹回放，所以没有历史表，避免无限成长的资料量。
  - `recordedAt`：装置端上报的时间
  - `receivedAt`：Backend 收到的时间（`@updatedAt`，每次 upsert 自动更新）——heartbeat/自动离线判断**一律用这个**，不用 `recordedAt`，避免装置时间不准造成误判

## Presence（即时状态）计算

`DriverPresenceStatus` 不是存在 DB 里的栏位，是每次读取时用 [gps.service.ts](../../apps/backend/src/modules/gps/gps.service.ts) 的 `computePresenceStatus`（纯函数）现场算出来的：

1. `isOnline === false` → `OFFLINE`
2. 否则算「距离最后一次收到 GPS 的秒数」（`receivedAt` 没有就退回 `onlineSince`）：
   - 超过 **120 秒**（`AUTO_OFFLINE_THRESHOLD_SECONDS`）→ `OFFLINE`（同时会顺手把 DB 里的 `isOnline` 打回 `false`，见下方「自动离线」）
   - 超过 **30 秒**（`CONNECTION_LOST_THRESHOLD_SECONDS`）→ `CONNECTION_LOST`
3. 上面两个都没触发、GPS 还新鲜：
   - 如果这个 Driver 手上有正在进行的 Leg（状态在 `ASSIGNED`/`ACCEPTED`/`DRIVER_ARRIVING`/`PASSENGER_ON_BOARD`/`COMPLETED` 之一，取最近更新的一笔），直接显示那个 Leg 的状态，取代单纯的 `ONLINE`——Admin 一眼就能看到「这个人现在在忙什么」
   - 都没有 → `ONLINE`

`BREAK` 保留在类型里但目前没有任何流程会产生这个状态（预留给未来「Admin 让 Driver 暂时休息」的功能）。

## 自动离线（不用 Cron）

没有另外起一个背景排程去扫描「谁超过 2 分钟没上传」，而是**在读取时顺手修正**：`listDriverPresence`/`getDriverPresence` 算出某个 Driver 目前该显示 `OFFLINE`、但 DB 里 `isOnline` 还是 `true` 时，会用一次 `updateMany` 把它打回 `false`（`onlineSince` 一并清空）。这样不需要额外的 worker process，只要有人在看 Dashboard（每 5 秒轮询一次）或查 Booking Detail，状态就会自动修正；就算完全没人查询，显示逻辑本身也已经正确处理了「DB 栏位过时」的情况，只是不会写回去而已——**正确性不依赖这次自愈有没有执行**。

## GPS 上传独立性（Reliability）

- `recordPing` 只做两件事：验证经纬度范围合法、确认 Driver 目前 `isOnline`，然后 upsert 一笔 `DriverLocation`。**完全不碰** `Leg`/`Booking`/`WalletTransaction` 任何一张表。
- 反过来，`driverJobs` 模块（Accept/Arriving/On Board/Complete）也完全不检查、不依赖 GPS 状态——Driver 就算从来没有 Go Online、一次 GPS 都没上传过，一样可以正常完成整个 Leg 生命周期。两边唯一的关联只在「读取显示」层：`getDriverPresence`/`listDriverPresence` 会去查一下 Leg 状态来决定要显示什么文字，但反过来不成立。
- 上传失败（网络问题、定位权限被拒等）在前端一律安静忽略、等下一次 5 秒后再试，不会跳出错误、不会阻断 Driver 操作其他功能。

## API

### Driver 端（`/api/driver/presence`）

- `GET /me` — 自己目前的 presence（含 status、位置、目前负责的 Leg）
- `POST /online` — Go Online（`isOnline=true`，记录 `onlineSince`，写 `DRIVER_WENT_ONLINE` Audit Log）
- `POST /offline` — Go Offline（`isOnline=false`，清空 `onlineSince`，写 `DRIVER_WENT_OFFLINE` Audit Log；**不会删除**最后一笔定位，留着给 Admin 参考「最后出现在哪里」）
- `POST /ping` — 上传一次定位：`{latitude, longitude, speed?, heading?, batteryPercent?, recordedAt?}`；Driver 不是 Online 状态时会被拒绝（409），避免留一份「看起来最新」但其实是离线后的定位资料

### Admin 端（`/api/admin/gps`）

- `GET /drivers?onlineOnly=true|false` — Dashboard List View 用；`onlineOnly`（默认 `true`）只排除真正 `OFFLINE` 的 Driver，`CONNECTION_LOST` 等其他状态都算「在线」一起显示（掉线中反而更需要被看到）
- `GET /drivers/:driverId` — 单一 Driver 的 presence，给 Booking Detail 页面用

高频率的 `ping` **刻意不写 Audit Log**（每 5 秒一次会把 Audit Log 灌爆），只有 Go Online/Go Offline 这种低频率、有意义的状态变化才记录。

## Frontend

- **Driver**：`DriverLayout` header 常驻一个 Online/Offline 开关（`DriverPresenceToggle`）——切成 Online 后，用 `navigator.geolocation.getCurrentPosition` 立刻上传一次，之后每 5 秒重复；尝试用非标准的 `navigator.getBattery()` 拿电量（大部分现代浏览器已不支持，拿不到就不带这个栏位，不影响上传）。开关状态是从 `/api/driver/presence/me` 读回来的（`status !== "OFFLINE"`），不是纯前端本地状态，重新整理页面也不会跑掉。
- **Admin**：`/gps` — GPS Live Tracking Dashboard，List View（第一版不做地图），每 5 秒轮询刷新（`refetchInterval`），可切换「只显示 Online」。
- **Booking Detail**：`LegList` 在 Leg 还有效进行中（`ASSIGNED`/`ACCEPTED`/`DRIVER_ARRIVING`/`PASSENGER_ON_BOARD`）且已指派 Driver 时，显示该 Driver 的即时状态 Tag + 「GPS Updated X sec ago」；Driver 是 `OFFLINE` 时改成醒目的橘色 Alert「该 Driver 目前 Offline」，符合规格「必须明显提示」的要求。

## 测试

- [gps.presence.test.ts](../../apps/backend/src/modules/gps/gps.presence.test.ts)：纯函数单元测试，覆盖 `computePresenceStatus` 的所有分支——Offline/Online/Connection Lost 边界（30 秒、120 秒的临界值）、Leg 状态覆盖显示、从来没收到过 GPS 时退回 `onlineSince` 计算。
- [gps.integration.test.ts](../../apps/backend/src/modules/gps/gps.integration.test.ts)：真实 Postgres 集成测试——Go Online/Offline 正确切换栏位、Offline 时上传 GPS 会被拒绝、同一个 Driver 重复上传只会覆盖同一笔（不是累积历史）、有进行中 Leg 时 presence 显示该 Leg 状态、超过自动离线门槛时 `listDriverPresence` 会自动把 DB 的 `isOnline` 修正回 `false`，以及**最关键的**「GPS 上传失败不能影响 Booking」场景——一个从来没有 Go Online、一次 GPS 都没上传过的 Driver，仍然能正常走完整个 Leg 生命周期直到 Complete。

浏览器手动验证：Driver 上线上传定位 → Admin Dashboard 正确显示 🟢 Online + 座标/速度/电量 → 超过 30 秒没有新的上传后自动变成 🟡 Connection Lost → Booking Detail 页面正确显示同样的状态 + GPS Updated X ago → Driver 下线后 Booking Detail 出现醒目的 Offline 提示 → 即使 Driver 处于 Offline，Accept → Arriving → On Board → Complete 整个流程依然正常跑完，全部验证通过。

## 已知限制

- 第一版没有地图（Google Maps）、没有轨迹回放、没有 Geofence、没有 ETA、没有路线规划——全部按规格明确留到以后
- `DriverLocation` 只存最新一笔，删掉旧资料没有任何历史可查，之后如果要做轨迹回放需要另外设计一张历史表（现在这张表的写入方式不适合直接改造）
- 自动离线检测靠「读取时顺手修正」，不是准时的背景排程——如果完全没有人在看 Dashboard、也没有人在看任何 Booking Detail，DB 里的 `isOnline` 栏位可能会一直停留在 `true` 不会主动被改掉；但这不影响任何人实际看到的显示结果是否正确，因为显示永远是即时算出来的
- `BREAK` 状态目前完全没有产生的入口，纯粹是为未来预留的栏位
- Driver 端拿电量用的 `navigator.getBattery()` 是已经被大多数主流浏览器移除的非标准 API，实际能拿到电量的情况会越来越少，属于「有就带、没有就算了」的锦上添花功能
