# Module 4: Collection（代收款）

## 概念

Collection 是独立于 [Wallet](./commission-wallet-settlement.md) 的第二本 Ledger：

- **Wallet** = 公司欠 Driver 的钱（Driver 的收入）
- **Collection** = Driver 暂时替公司保管的钱（帮顾客买东西、代付费用、收现金/转账，这笔钱属于公司，不是 Driver 收入）

两本帐完全独立，Collection **永远不会直接修改** Wallet 的任何栏位。两者只在 Daily Settlement 计算净额时被放在一起相减一次：

```
Net Settlement = Wallet（Driver Earnings） - Collection（代收款）
```

- 净额为正：Company Pay Driver
- 净额为负：Driver Need Return Company

## 资料模型

`Collection` 栏位：`bookingId`、`legId`（选填）、`driverId`、`customerName`（选填）、`purpose`、`amountCents`、`paymentMethod`、`status`、`collectedAt`、`createdBy`、`remark`、`proofImageUrl`，另外 `verifiedAt`/`verifiedBy`、`voidedAt`/`voidedBy`/`voidReason`、`settledAt`/`settlementId` 记录各阶段的操作者与时间。

**Payment Method**：`CASH`、`TRANSFER_TO_DRIVER`、`TRANSFER_TO_COMPANY`、`TNG`、`OTHER`

**Purpose**：`ITEM_PURCHASE`、`DELIVERY_FEE`、`PARCEL`、`EXTRA_CHARGE`、`PARKING`、`TOLL`、`OTHER`

**Status**：`PENDING` → `COLLECTED` → `VERIFIED` → `SETTLED`，任何阶段（`SETTLED` 除外）都可以被 `VOIDED`。

> 目前没有「Admin 先指派代收任务」的流程，所以 Driver 新增 Collection 时会直接建立成 `COLLECTED`（代表钱已经在手上）。`PENDING` 保留给未来可能的指派流程使用，目前系统不会产生这个状态。

## Driver 权限

- `POST /api/driver/collections` — 新增 Collection（`bookingId` 必填，`legId` 选填但如果填了必须属于该 Booking；`amountCents` 必须 > 0）
- `GET /api/driver/collections` — 只能看到自己的
- `GET /api/driver/collections/:id`
- `POST /api/driver/collections/:id/proof-image`（`multipart/form-data`，欄位名 `file`）— 上传收据/转账截图，`COLLECTED` 状态才能上传；一旦是 `VERIFIED`/`SETTLED`/`VOIDED` 就不能再改
- 没有任何 API 能让 Driver 修改已经 Verified 的 Collection，也没有 Delete API（不能删除）

## Admin 权限

- `GET /api/admin/collections` — 支持 `driverId`/`bookingId`/`status`/`paymentMethod`/`purpose`/`search`（比对 customerName、remark）/`dateFrom`/`dateTo` 筛选、分页
- `GET /api/admin/collections/:id`
- `POST /api/admin/collections/:id/verify` — 只有 `COLLECTED` 能被 Verify；条件式 UPDATE，重复呼叫（重复 Verify）第二次会失败（409）
- `POST /api/admin/collections/:id/void` — `{reason}`；`PENDING`/`COLLECTED`/`VERIFIED` 都可以 Void，`SETTLED` 不能直接 Void（要撤销要走 Void Settlement）

Admin 没有新增 Collection 的 API——代收款一定是从 Driver 那边发起的。

## 图片上传

目前没有云端储存，采用最简单可靠的做法：Backend 用 `multer` 存到本地磁盘（`apps/backend/uploads/collections/`），限制 JPEG/PNG/WEBP、单档最大 5MB，透过 `express.static` 在 `/uploads/...` 路径提供读取。

**已知限制**：本地磁盘在 Railway 等平台重新部署时会被清空，正式环境部署前需要挂载 persistent volume，或改接 S3 类的对象存储。

## Settlement 整合

Collection 参与 Daily Settlement，但完全不影响 Wallet 既有逻辑：

- `previewSettlement`/`confirmSettlement` 现在会**同时**查询该 Driver 在指定周期内的 PENDING Wallet Transaction 跟 VERIFIED Collection（用 `collectedAt` 而不是 `effectiveDate` 判断是否落在周期内）。
- `Settlement` 新增 `walletAmountCents`（原本的 net，改名）、`collectionAmountCents`（这次结算纳入的代收款总额），`netAmountCents = walletAmountCents - collectionAmountCents`。
- Confirm 时同样用条件式 `UPDATE ... WHERE status='VERIFIED'` 把 Collection 标成 `SETTLED`（跟 Wallet Transaction 标 `SETTLED` 走同一个 DB Transaction），改动笔数不对就整个回滚——这是「重复 Settlement」不会重复计算的机制：已经 `SETTLED` 的 Collection 不会再被任何一次 Preview/Confirm 捞到。
- 只要 Wallet Transaction 跟 Collection 都是空的才会拒绝 Confirm；只有 Collection、没有 Wallet 收入（或反过来）都是合法的结算。

### Void Settlement 对 Collection 的处理

跟 Wallet Transaction 的处理方式刻意不同：

- Wallet Transaction 是不可变金额帐本，Void 后原始纪录永远保持 `SETTLED` 不变，另外新增一笔反向纪录去抵销。
- **Collection 的 `status` 单纯是工作流程状态，不是不可变金额帐本**，Void Settlement 时会直接把这个 Settlement 底下的 Collection 从 `SETTLED` 打回 `VERIFIED`（清空 `settledAt`/`settlementId`），让它们能被下一次日结重新纳入。这样比照 Wallet 另开反向纪录更简单，而且语意更直觉：「这笔代收款的结算被撤销了，它欠公司的钱还没有真正被处理」。

## Audit Log

`COLLECTION_CREATED`、`COLLECTION_PROOF_UPLOADED`、`COLLECTION_VERIFIED`、`COLLECTION_VOIDED` 都会写入 `audit_logs`（沿用统一的 `writeAuditLog`）。Void Settlement 连带重开 Collection 的动作**不会**逐笔另外写 Collection 级别的 log，只在 `SETTLEMENT_VOIDED` 的 `metadata.collectionsReopenedCount` 记一个数量，避免跟 Wallet 反向纪录的做法重复堆 log。

## Frontend

- Admin：`/collections` — 列表（含 Driver 栏位）、Filter（Driver/状态/Payment Method/Purpose）、Search（Customer/Remark）、查看图片（缩图 + 点击预览）、Verify、Void
- Driver：`/driver/collections` — 新增 Collection（从自己的 Leg 列表选 Booking/Leg）、上传证明图片、查看自己的 Collection
- Daily Settlement / Settlement History 页面新增 Wallet / Collection / Net Amount 三栏拆分显示，净额为负时以红字标示「Driver Need Return Company」

## 测试

[collection.integration.test.ts](../../apps/backend/src/modules/collections/collection.integration.test.ts) 用真实的本地 Postgres 覆盖：Cash / Transfer To Driver / Transfer To Company 三种 Payment Method 的建立与 Verify、Settlement 净额为正（Company Pay Driver）与为负（Driver Need Return Company）两种情况、Void（含重复 Void 会被拒绝、SETTLED 后不能直接 Void）、重复 Verify 会被拒绝、重复 Settlement 不会让同一笔 Collection 被算两次、Void Settlement 会把 Collection 打回 VERIFIED 并能被下一次日结重新纳入。

## 已知限制

- 图片上传用本地磁盘，正式环境部署需要额外处理持久化存储（见上）
- `PENDING` 状态目前没有任何流程会产生，保留给未来「Admin 指派代收任务」用
- 没有金额汇总报表，只有明细列表
- Void Settlement 重开的 Collection 不会另外写逐笔 Audit Log，只在 Settlement 层级记录数量
