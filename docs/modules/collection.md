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

`Collection` 栏位：`bookingId`、`legId`（选填）、`driverId`（选填，见下方 Collected By）、`customerName`（选填）、`purpose`、`amountCents`、`paymentMethod`、`status`、`collectedAt`、`createdBy`、`remark`、`proofImageUrl`，另外 `verifiedAt`/`verifiedBy`、`voidedAt`/`voidedBy`/`voidReason`、`settledAt`/`settlementId` 记录各阶段的操作者与时间，`updatedAt`（Module 13 新增）自动追踪最后修改时间。`relatedChargeId`/`expectedAmountCents`/`parentCollectionId` 是 Financial Model v2 阶段加的 Partial Collection/对账栏位，见 [financial-model-v2.md](../design/financial-model-v2.md) 第 6 章。

**Payment Method**：`CASH`、`TRANSFER_TO_DRIVER`、`TRANSFER_TO_COMPANY`、`TNG`、`OTHER`

**Purpose**：`ITEM_PURCHASE`、`DELIVERY_FEE`、`PARCEL`、`EXTRA_CHARGE`、`PARKING`、`TOLL`、`OTHER`

**Status**：`PENDING` → `COLLECTED` → `VERIFIED` → `SETTLED`，任何阶段（`SETTLED` 除外）都可以被 `VOIDED`。

> 目前没有「Admin 先指派代收任务」的流程，所以 Driver 新增 Collection 时会直接建立成 `COLLECTED`（代表钱已经在手上）。`PENDING` 保留给未来可能的指派流程使用，目前系统不会产生这个状态。

## Collected By / Receiver（Module 13：Collection Ledger Schema）

设计依据：[collection-module-v1.md](../design/collection-module-v1.md)。这次只做 Schema/Migration/Backfill，**Collection API/Service 完全没有改动**——`collection.service.ts`/`collection.controller.ts`/`driverCollection.controller.ts`/Frontend 一行都没动，既有的 Driver 代收流程原样继续运作。

**新增栏位**：

| 栏位 | 型别 | 说明 |
|---|---|---|
| `collectedBy` | `CollectedBy`（`DRIVER` \| `COMPANY`） | 谁的角色收的钱，跟 `paymentMethod`（怎么付）是刻意分开的两个独立维度，不合并成 `TRANSFER_TO_DRIVER`/`TRANSFER_TO_COMPANY` 这种揉在一起的写法。`@default(DRIVER)`，既有 create 流程不用改。 |
| `receiverType` | `CollectionReceiverType`（`DRIVER` \| `COMPANY`） | `receiverId` 指向哪一种实体的判别栏位。v1 恒等于 `collectedBy`（DB CHECK constraint 保证），分成两个栏位是为了未来两者有可能分歧时不需要再动一次 Schema。`@default(DRIVER)`。 |
| `receiverId` | `Int?` | `receiverType=DRIVER` 时应该等于 `driverId`（同一个实体）；`receiverType=COMPANY` 时目前没有结构化的「公司收款账户」资料表，先留空。 |
| `receiverLabel` | `String?` | 自由文本 Receiver 名称（例如 `"Company Account A"`），在结构化的公司收款账户清单出现之前先用这个记录。 |

`driverId` 从 `NOT NULL` 放宽成可为 `NULL`：`collectedBy = COMPANY` 时可以不挂 Driver，也可以保留（纯粹记录这笔钱归属于哪个 Driver 的哪趟行程，方便对账）——但**不构成该 Driver 的 Settlement 负债**，这个过滤规则还没有接进 Settlement 查询（见下方已知限制）。

**CHECK Constraints**（Prisma schema 语法不支援任意 CHECK，写在 migration.sql）：

1. `collected_by <> 'DRIVER' OR driver_id IS NOT NULL` —— Collected By = DRIVER 时必须关联具体 Driver（业务规则 2）
2. `receiver_type IS NULL OR receiver_type::text = collected_by::text` —— receiverType 必须跟 collectedBy 一致
3. `receiver_type IS DISTINCT FROM 'DRIVER' OR receiver_id IS NULL OR receiver_id = driver_id` —— receiverType=DRIVER 时，若填了 receiverId 必须等于 driverId

**Index**（`collections` 表原本只有 `relatedChargeId`/`parentCollectionId` 两个 index，这次一并补齐常用查询路径）：`driverId+status+collectedAt`（复合，对应 Settlement 抓取周期内 Collection 的查询）、`bookingId`、`status`、`collectedBy`、`receiverType+receiverId`（复合）。

**FK 删除策略**：`driverId` 外键改成 `ON DELETE RESTRICT`（不是 Prisma 对 optional 关联的默认值 `SET NULL`）——跟 `wallet_transactions`/`trip_expenses` 这两本姊妹 Ledger 的 `driver` 外键行为保持一致，只要 Driver 还有 Collection 记录就不能被物理删除。

**Backfill 规则与结果**（`20260813000000_collection_ledger_receiver_model`）：

| 既有 `paymentMethod` | 判定为 `collectedBy` | 理由 |
|---|---|---|
| `TRANSFER_TO_COMPANY` | `COMPANY` | 客户直接付给公司，Driver 从未持有这笔钱 |
| `CASH` / `TRANSFER_TO_DRIVER` | `DRIVER` | 明确是 Driver 代收，`receiverId` 一并回填成既有的 `driverId` |
| `TNG` / `OTHER` | 不静默猜测，停留在 `ADD COLUMN` 阶段的 DEFAULT（`DRIVER`） | TNG 可能转去 Driver 或公司的电子钱包，OTHER 完全不明确，无法从付款方式安全判断；哪些既有记录落在这条规则，migration.sql 里附了一段人工复核查询 |

本地 dev DB（`car_team_dev`）套用这个 Migration 时，`collections` 表是**空表（0 笔资料）**，所以这次 Backfill 实际上没有改动任何一笔既有记录；上面的规则是为了让这个 Migration 在未来「已经有资料」的环境（staging/production）套用时行为正确、可预期。

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

目前没有云端储存，采用最简单可靠的做法：Backend 用 `multer` 存到本地磁盘（`apps/backend/uploads/collections/`），限制 JPEG/PNG/WEBP、单档最大 Max Upload File Size（预设 5MB，Module 8 起可在 Company Settings 调整，1–20MB；multer 本身另外设了 20MB 的硬上限防滥用，详见 [company-settings.md](company-settings.md)），透过 `express.static` 在 `/uploads/...` 路径提供读取。

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

[collection.integration.test.ts](../../apps/backend/src/modules/collections/collection.integration.test.ts) 用真实的本地 Postgres 覆盖：Cash / Transfer To Driver / Transfer To Company 三种 Payment Method 的建立与 Verify、Settlement 净额为正（Company Pay Driver）与为负（Driver Need Return Company）两种情况、Void（含重复 Void 会被拒绝、SETTLED 后不能直接 Void）、重复 Verify 会被拒绝、重复 Settlement 不会让同一笔 Collection 被算两次、Void Settlement 会把 Collection 打回 VERIFIED 并能被下一次日结重新纳入。这次 Module 13 的 Schema 改动完全没有动这个文件——证明既有 API/Service 不用改就能继续正常运作。

[collectionSchema.integration.test.ts](../../apps/backend/src/modules/collections/collectionSchema.integration.test.ts)（Module 13 新增，12 个测试）直接用 Prisma Client 操作新栏位，不经过 Service 层，专门验证 Schema 本身：默认值（不指定 `collectedBy`/`receiverType` 时落在 `DRIVER`/`DRIVER`）、`updatedAt` 自动推进、`collectedBy=COMPANY` 时 `driverId` 可以留空也可以保留、3 个 CHECK constraint 各自的通过/拒绝案例、`driverId` 外键的 `RESTRICT` 删除策略、5 个新 Index 确实存在（查 `pg_indexes`）。

## 已知限制

- 图片上传用本地磁盘，正式环境部署需要额外处理持久化存储（见上）
- `PENDING` 状态目前没有任何流程会产生，保留给未来「Admin 指派代收任务」用
- 没有金额汇总报表，只有明细列表
- Void Settlement 重开的 Collection 不会另外写逐笔 Audit Log，只在 Settlement 层级记录数量
- ~~Settlement 还没有依 `collectedBy` 过滤~~：已在 Mobile UAT Bug Fix 阶段解决——`collection.service.ts` 的 `getCollectionsInPeriod`/`getCollectionsOutsidePeriod`/`getUnverifiedCollections` 现在都会过滤 `collectedBy=DRIVER`，照 [collection-module-v1.md](../design/collection-module-v1.md) 第 4 章的设计，`collectedBy=COMPANY` 的记录不再计入 Driver 的 Settlement 负债。同一阶段也修复了「`COLLECTED` 但还没 Verify 的代收款会从 Settlement Preview 完全消失」的问题：现在会出现在 Excluded Collections，标注「收款尚未审核」，不再被静默忽略。
- **Collected By / Receiver 目前没有任何 API 会写入**：`collection.service.ts` 的 `createCollection` 还是只会建立 `collectedBy=DRIVER`（沿用 DEFAULT），Admin/Driver 都没有介面可以指定 Collected By 或填写 Receiver。这次是 Schema-only 阶段，实际的 Create/Update 支援留给下一阶段的 Collection API。
- **Receiver 的结构化程度还没决定**：`receiverType=COMPANY` 时 `receiverId` 目前恒为 `NULL`（没有「公司收款账户」资料表），只能靠自由文本 `receiverLabel`。要不要为公司收款账户建一张正式的资料表，是 [collection-module-v1.md](../design/collection-module-v1.md) 第 12 章列出的尚未决定的业务规则。
- **Partial Collection 的跨行金额验证没有 DB 层保证**：「同一组 Partial Collection 的 collectedAmount 总额不能超过 expectedAmount」是跨行加总规则，Postgres CHECK constraint 做不到跨行验证，这次没有加 Trigger，留给未来 API 阶段做 Service 层验证（跟 Revenue Sharing/BookingCharge 的既有验证方式一致，不是这个专案第一次这样处理）。
