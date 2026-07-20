# Module 3: Commission、Driver Wallet、Daily Settlement

## 概念

Booking 有一个总价（`totalAmountCents`），依抽成设定拆成 Platform Amount（平台抽成）和 Driver Pool（司机分成池）。每个 Leg 可以设定一个 `earningAllocationCents`（这段 Leg 完成后司机应得多少钱），所有未取消 Leg 的 allocation 总和不能超过 Driver Pool。

Leg 第一次成功变成 `COMPLETED` 时，系统会自动在 `wallet_transactions` 里建一笔 `LEG_EARNING`，金额就是那笔 Leg 的 allocation。这是唯一的记账来源，不做「可以直接改的余额栏位」——所有金额都是从这个 ledger 加总出来的，历史上的每一笔都不会被修改或删除，要更正就新增一笔 Adjustment。

Admin 可以帮某个 Driver 针对指定的时间区间做「日结」（Daily Settlement）：把该区间内所有 PENDING 的 Transaction 标记成 SETTLED，产生一笔不可变的 Settlement 记录。已结算的 Transaction 不会消失，只是状态变了，历史全部保留。需要撤销一次结算时走正式的 Void 流程（见下），不会直接删除或修改历史记录。

**所有金额一律用整数 cents 存**，Backend 完全不使用浮点数运算；换算、显示成 `RM 60.00` 的格式是 Frontend 的事，Backend 只处理 cents 整数，Frontend 也不能自己决定任何最终金额。

## 抽成设定（Commission）

- `CompanySettings`（单例表，只有 Backend/DB，没有 UI）：`defaultCommissionType`（PERCENTAGE|FIXED_AMOUNT）、`defaultCommissionValue`（PERCENTAGE 时是整数百分比如 15；FIXED_AMOUNT 时是 cents）。目前系统默认 `PERCENTAGE` 15%，**没有写死在程式码里**，改这个表就能改全公司默认值。
- Booking 建立时，如果没有指定 `commissionType`/`commissionValue`，就读 `CompanySettings` 当默认值，"复制"（snapshot）到这张 Booking 自己的 `platformCommissionType`/`platformCommissionValue` 栏位——之后要单独调整某一张特殊 Booking 的抽成，改这张 Booking 就好，不会影响全公司设定，也不会影响已经建立的其他 Booking。
- `platformAmountCents`、`driverPoolAmountCents` 一律由 Backend 用 [commission.ts](../../apps/backend/src/modules/bookings/commission.ts) 里的 `calculateCommissionSplit` 算出来，不接受前端直接传这两个值。
- **Percentage 抽成的四舍五入规则统一**：所有金额换算都经过 [money.ts](../../apps/backend/src/common/money.ts) 的 `roundToNearestCent`（四舍五入到最接近的分，即 round-half-up），全专案只有这一个地方做金额的四舍五入，避免各处逻辑各算各的导致总额对不上。
- 已经有 `COMPLETED` 的 Leg，或已经有任何 `wallet_transactions` 记录的 Booking，不可以再改总价或抽成（[allocation.ts](../../apps/backend/src/modules/bookings/allocation.ts) 的 `hasEarningHistory` 检查）。

## Leg Earning Allocation

- `Leg.earningAllocationCents`，Admin 在 Booking 详情页设定。
- 规则（[legs.service.ts](../../apps/backend/src/modules/bookings/legs.service.ts) 的 `assertAllocationFits`）：
  - 不可为负数
  - 所有「未取消」Leg 的 allocation 总和不能超过 `driverPoolAmountCents`（可以少于，Booking 详情页会显示 Remaining Unallocated）
  - Leg 已经是 `COMPLETED`/`CANCELLED` 就不能再改（`updateLeg` 一开始就挡掉）
  - 这个 Leg 已经产生过 `wallet_transactions` 记录（无论什么状态）就不能再改 allocation——这是比状态检查更保险的第二层防护，避免任何未来状态机变化意外开了一个后门
  - 新增 Leg 时也会一起检查总和（不会因为多加一个 Leg 就超过 Driver Pool）

## Wallet Transaction Ledger

`wallet_transactions` 只能新增，不能改历史金额：

- `transactionType`：
  - `LEG_EARNING`——Leg 完成时系统自动建立
  - `MANUAL_ADJUSTMENT`——Admin 手动新增的一般性调整（不挂在任何 Settlement 上）
  - `SETTLEMENT_ADJUSTMENT`——两种来源：(1) Admin 针对某笔已存在的 Settlement 手动新增的更正（正数或负数，必须填 Reason），(2) Void Settlement 时系统自动产生的反向纪录
- `status`：`PENDING` → `SETTLED`（日结时）；`VOIDED` 目前保留在 enum 里，实际上不会有任何流程把 Transaction 直接改成这个状态——**已经 `SETTLED` 的 Transaction 永远不会被改回 `PENDING` 或被修改/删除**，Void 一笔 Settlement 时原始 Transaction 完全不动，另外新增反向纪录（见下方 Void 章节）。
- `@@unique([legId, transactionType])`：DB 层保证一个 Leg 一辈子只会有一笔 `LEG_EARNING`。反向纪录（Void 产生的）故意不带 `legId`（设为 `null`），避免同一个 Settlement 被反复触发相关逻辑时跟这个唯一约束冲突。
- `relatedSettlementId`：反向纪录专用栏位，指向被 Void 的那笔 Settlement，跟「这笔交易被结算在哪个 Settlement 里」的 `settlementId` 是两个独立栏位，不会混在一起。
- 要更正一笔已经产生的 Transaction，一律新增一笔新的（`MANUAL_ADJUSTMENT` 或 `SETTLEMENT_ADJUSTMENT`），永远不会去改或删原本那笔。

## Daily Settlement（区间制）

- `Settlement` 记录一个明确的 `periodStart`/`periodEnd`（日期），不再是「结算这天为止所有还没结算的」累积模式——只有 `effectiveDate` 落在这个区间内的 PENDING Transaction 会被这次结算纳入，区间外的 PENDING Transaction 保持不动，留给以后的结算。
- `Settlement` + `SettlementItem`：`SettlementItem.walletTransactionId` 加 `@unique`，保证一笔 Transaction 永远只能属于一个 Settlement。
- 流程（[settlement.service.ts](../../apps/backend/src/modules/settlement/settlement.service.ts)）：
  1. **Preview**：Admin 指定 Driver + Period Start/End，算出区间内 PENDING Transaction（Included）跟区间外仍未结算的 PENDING Transaction（Excluded，纯粹给 Admin 提醒「这个 Driver 还有其他未结算项目落在区间外」），分类成 Completed Leg Earnings / Positive Adjustments / Negative Adjustments，算出 Net Settlement Amount——这一步不写 DB，纯预览。
  2. **Confirm**：Backend **重新查一次**区间内的 PENDING Transaction（不相信 Preview 时前端拿到的列表或总额），全部包在一个 DB Transaction 里：产生 Settlement Reference → 建立 Settlement → 建 SettlementItem → 用条件式 `UPDATE ... WHERE status='PENDING'` 把这些 Transaction 标成 `SETTLED`。改动笔数跟原本要结算的笔数不一样，代表中途被别人抢先动过，直接丢错、整个 Settlement 回滚不生效——这就是两个 Admin 同时按日结只有一个成功的机制。
  3. 一笔 Transaction 都没有可结算时直接拒绝（不允许「空的」Settlement）。
  4. `periodStart` 必须 `<=` `periodEnd`，否则拒绝。
- **Settlement Reference**：格式 `SET-YYYYMMDD-0001`（日期是建立当天，序号是当天第几笔），由 Backend 在 `confirmSettlement` 内产生，DB (`reference` 栏位) 加 `@unique` 双重保险。并发安全做法：用 `pg_advisory_xact_lock(hashtext('settlement-ref-<date>'))` 把「同一天」的序号产生锁住，同一天内的两个请求会排队而不是拿到重复序号；已经用测试验证「两个不同 Driver 同时确认日结」会各自拿到不同的 Reference。
- `Settlement.status`：`DRAFT`（目前没有会产生 DRAFT 的流程，保留给以后可能的多步骤审核用）、`COMPLETED`（Preview 之后直接 Confirm 就是 COMPLETED）、`VOIDED`。COMPLETED 的 Settlement 不能再被编辑（Void 是唯一允许的状态转换，且只能做一次）。

## Void Settlement

- 只能对状态是 `COMPLETED` 的 Settlement 执行，不能删除任何 Settlement 记录。
- Admin 必须填 Void Reason；系统记录 `voidedAt`（时间）、`voidedBy`（Admin 的 User id）。
- 用条件式 `UPDATE ... WHERE id = ? AND status = 'COMPLETED'` 把状态改成 `VOIDED`，改动笔数不是 1 就直接拒绝——防止同一个 Settlement 被同时 Void 两次，或对一个已经不是 COMPLETED 的 Settlement 重复执行。
- **不会动原始 Wallet Transaction**：原本已经 `SETTLED` 的 Transaction 维持 `SETTLED`、金额不变，永远不会被改回 `PENDING`。
- 会自动为这个 Settlement 底下的每一笔 SettlementItem，新增一笔金额相反（正负号相反）的 `SETTLEMENT_ADJUSTMENT` 反向 Transaction，状态 `PENDING`，`relatedSettlementId` 指向被 Void 的这笔 Settlement，之后会正常流入下一次的日结。
- 原始 `Settlement` 跟 `SettlementItem` 记录完整保留，不会被删除或改写（除了状态栏位跟 Void 相关的三个栏位）。
- 全程包在一个 DB Transaction 里，并写一笔 `SETTLEMENT_VOIDED` 的 Audit Log。

## Settlement Adjustment（针对已结算记录的更正）

- API：`POST /api/admin/wallet/settlement-adjustments`，参数 `driverId`、`amountCents`（可正可负）、`reason`（必填）、`effectiveDate`（必填）、`relatedSettlementId`（选填，注明这笔调整跟哪个 Settlement 有关）。
- 一律建立**新的** `SETTLEMENT_ADJUSTMENT` Transaction，状态 `PENDING`，会流入下一次日结——不会去修改或删除任何既有的 Adjustment 或 Settlement 记录。要「取消」一笔 Adjustment，做法是再新增一笔金额相反的 Adjustment（反向冲销），而不是改动原本那笔。
- 建立者（`createdBy`）会记录成执行操作的 Admin User id，并写一笔 `SETTLEMENT_ADJUSTMENT_CREATED` 的 Audit Log。

## 金额计算与货币规则（Currency）

- DB 所有金额栏位都是整数 cents（`Int`），没有任何 `Decimal`/`Float` 金额栏位。
- Backend 计算金额全程只做整数运算，唯一的四舍五入入口是 `roundToNearestCent`（round-half-up，四舍五入到分）。
- Frontend 完全不做金额计算，只透过 [money.ts](../../apps/frontend/src/lib/money.ts) 的 `formatCents`（cents → `RM 60.00` 显示字串）跟 `ringgitToCents`（表单输入的 RM 数字 → 送给 API 的 cents 整数）做单纯的显示/输入转换。
- API 回应一律用 `xxxCents` 命名清楚标示这是整数 cents，没有任何栏位是「已格式化的金额字串」跟「cents 数字」混用同一个栏位名称的情况。

## Audit Log

`audit_logs` 现在统一透过 [audit.ts](../../apps/backend/src/common/audit.ts) 的 `writeAuditLog` 写入，固定包含 `actorUserId`、`actorRole`、`action`、`entityType`、`entityId`、`beforeData`、`afterData`、`timestamp`（`metadata` 栏位保留给辅助资讯，例如反向 Transaction 笔数）。

会写 Audit Log 的财务相关操作：`BOOKING_COMMISSION_UPDATE`（Booking 总价/抽成变更，含变更前后完整栏位）、`LEG_ALLOCATION_UPDATE`（Leg allocation 变更）、`LEG_EARNING_CREATED`（Leg 完成自动记账）、`MANUAL_ADJUSTMENT_CREATED`、`SETTLEMENT_ADJUSTMENT_CREATED`、`SETTLEMENT_COMPLETED`、`SETTLEMENT_VOIDED`（另外也顺手加了 `COMPANY_SETTINGS_UPDATE`）。

## 财务资料保护（Guard Rails）

- Booking 有 `COMPLETED` 的 Leg，或已经有任何 `wallet_transactions` 记录 → 不能改总价/抽成。
- Leg 已经产生 `wallet_transactions` 记录 → 不能改 allocation（即使 Leg 本身状态还允许改，也会被这层挡掉）。
- Transaction 状态是 `SETTLED` → 没有任何 API 能修改或删除它，只能透过新增 Adjustment 或 Void+反向纪录来更正净额。
- Settlement 状态是 `COMPLETED` 或 `VOIDED` → 不能编辑内容，`COMPLETED` 只能被 Void 一次，`VOIDED` 之后就是终态。
- 所有会影响金额的写入（Commission 计算、Allocation 检查、Settlement Reference 产生、四舍五入）都在 Backend service 层完成，没有任何 API 接受 Frontend 直接传入「最终金额」让 Backend 原样存档。

## API

- `GET /api/admin/company-settings`、`PATCH /api/admin/company-settings` — ADMIN only
- Booking/Leg 的既有 API（`POST /api/bookings`、`PATCH /api/bookings/:id`、`POST /api/bookings/:id/legs`、`PATCH /api/bookings/:id/legs/:legId`）都加了新栏位，见 [booking.md](./booking.md)
- `GET /api/admin/wallet/transactions` — 筛选 driverId/status/日期区间
- `GET /api/admin/wallet/unsettled-by-driver` — 各 Driver 目前未结算总额
- `POST /api/admin/wallet/adjustments` — 新增 Manual Adjustment（driverId, amountCents 可正可负, reason, effectiveDate）
- `POST /api/admin/wallet/settlement-adjustments` — 新增 Settlement Adjustment（driverId, amountCents, reason, effectiveDate, relatedSettlementId 选填）
- `GET /api/admin/settlements/preview?driverId=&periodStart=&periodEnd=`
- `POST /api/admin/settlements` — 建立并直接 Confirm（{driverId, periodStart, periodEnd}）
- `GET /api/admin/settlements`、`GET /api/admin/settlements/:id`
- `POST /api/admin/settlements/:id/void` — {reason}
- `GET /api/driver/wallet/summary` — Today Pending / Current Unsettled / Total Settled
- `GET /api/driver/wallet/transactions` — 自己的交易记录
- `GET /api/driver/settlements` — 自己的结算记录

Driver 端的 API 一律只能看到、操作自己的资料（用登入者的 `driverId` 限定查询条件），没有任何 API 能让 Driver 看到别人的 Wallet 或自己新增 Adjustment/执行 Settlement/Void。

## Frontend

- Admin：`/wallet`（Wallet，含 Unsettled by Driver 总览、交易明细含 Related Settlement 显示、新增 Manual Adjustment）、`/settlements/daily`（Daily Settlement，选 Driver + Period Start/End → Preview 显示 Included/Excluded Transactions → Confirm）、`/settlements/history`（Period 栏位、Void 操作、Settlement Adjustment 操作）
- Driver：`/driver/earnings`（My Earnings，三个统计卡 + 交易记录）、`/driver/settlements`（自己的结算记录）
- Booking 详情页新增 Booking Total / Platform Commission / Platform Amount / Driver Pool / Allocated to Legs / Remaining Unallocated 显示，以及「编辑」入口调整总价/抽成（有收入历史时栏位会被锁住）；每个 Leg 多了「设定收入」操作
- 金额显示统一走 [money.ts](../../apps/frontend/src/lib/money.ts) 的 `formatCents`，格式固定是 `RM 60.00`

## 测试

[wallet.integration.test.ts](../../apps/backend/src/modules/wallet/wallet.integration.test.ts) 用真实的本地 Postgres，分两组：

- 原始 Module 3 的 8 个场景（两个 Driver 各分RM24、同一个 Driver 拿两段共RM48、重复 Complete 不重复记账、只有真正完成的 Leg 才有收入、日结后历史保留、两个并发日结只成功一个、allocation 超过 Driver Pool 会被拒绝、Completed Leg 不能改 allocation）
- 本次加强新增的场景：正数/负数 Settlement Adjustment、零金额 Adjustment 会被拒绝、同一个 Settlement 重复 Void 会被拒绝、Void 会产生正确的反向纪录（原始记录维持 SETTLED 不变、反向纪录是 PENDING 且带 `relatedSettlementId`）、日结只会纳入指定区间内的 Transaction（区间外的正确被排除）、两个不同 Driver 同时确认日结会拿到不重复的 Settlement Reference、已经有收入记录的 Booking 不能再改总价

加上 [commission.test.ts](../../apps/backend/src/modules/bookings/commission.test.ts) 覆盖抽成计算（含四舍五入规则）的纯函数逻辑。全部 32 个测试通过。

## 已知限制

- `Settlement.status` 的 `DRAFT` 状态目前用不到（现在的流程是 Preview 完直接 Confirm 变 COMPLETED，没有「先存草稿再送审」的中间步骤）
- 没有做金额汇总报表/图表，只有明细列表
- 沒有处理跨月/跨年的结算周期设定，目前完全由 Admin 自己决定 Period Start/End
- Void 产生的反向纪录会正常流入「下一次」日结，中间这段时间 Driver 的「未结算金额」会短暂显示负数（这是刻意设计，代表欠公司/需要扣回的钱），不是 bug
