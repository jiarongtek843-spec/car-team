# Module 12: Wallet Migration（Financial API Phase 3）

> 承接 [revenue-sharing-api.md](./revenue-sharing-api.md)（Revenue Sharing Preview/Finalize/Snapshot）。这次把 Finalize 算出来的 `driverPoolCents` 正式写进 Driver Wallet。不要开始 Settlement/Trip Expense/Collection，也没有 Frontend。
>
> **业务流程调整**：最初设计是 Finalize（建立 Snapshot）→ Issue Wallet（手动发放）两个步骤；后来简化成 **Finalize 一步完成**——Finalize 本身就代表财务确认，分两步只会增加漏发、重复操作的风险。没有独立的 Issue Wallet 端点。未来如果需要审批流程，预期会是 `Preview → Approve → Finalize`（自动 Issue Wallet）三步，`Approve` 是新增的独立步骤，不是把 Issue Wallet 拆回来——这次不实作 `Approve`。

## Financial Version Cut-over

在这之前，Driver 的收入只有一条路径：Leg 完成时 `completeLeg` 立刻建立一笔 `LEG_EARNING`（Module 3，用的是 Booking 层级的旧 2-way commission，`driverPoolAmountCents`）。Revenue Sharing（Module 11）引入了一套新的 3-way 分润（Company Commission / Dispatcher Commission / Driver Pool，来自 Booking Charge），但只写进 Snapshot，没有真正发钱——如果这次直接让 Finalize 也对已经付过 `LEG_EARNING` 的 Leg 再发一次，会造成**同一笔钱被算两次**。

解决方式不是「运行时判断这个 Leg 有没有 `LEG_EARNING`」（新旧两个金额来源可能算出不同数字，悄悄跳过会吃掉差额），而是**Migration Cut-over**：每张 Booking 一辈子只属于一个 Financial Version，禁止混用两套收入模型。

`bookings.financial_version`（枚举 `FinancialVersion { V1, V2 }`）：

- **V1**：这次 migration（[`20260810000000_wallet_migration_financial_version`](../../apps/backend/prisma/migrations/20260810000000_wallet_migration_financial_version/migration.sql)）部署**之前**就存在的所有 Booking，被这个 migration 自动回填成 V1。继续使用既有的 `LEG_EARNING` 机制；**不参与 Revenue Sharing Wallet**——Finalize 仍然可以对 V1 Booking 执行（建立 Snapshot，纯计算/报表用途），但不会发放任何 Wallet Transaction。
- **V2**：migration 部署**之后**新建立的 Booking，DB 栏位默认值就是 V2（不需要应用层判断「现在有没有过 Cut-over 时间点」）。Leg 完成时完全不建立 `LEG_EARNING`；Finalize 成功的同一个 Transaction 里会自动把 `driverPoolCents` 发放成 Wallet Transaction。

### 两段式 DEFAULT 达成 Cut-over

```sql
ALTER TABLE "bookings" ADD COLUMN "financial_version" "FinancialVersion" NOT NULL DEFAULT 'V1';
ALTER TABLE "bookings" ALTER COLUMN "financial_version" SET DEFAULT 'V2';
```

第一句的 `DEFAULT 'V1'` 让 Postgres 自动帮「这次 migration 之前」的所有既有 Booking 回填成 V1；第二句把栏位**往后**的默认值改成 V2。两句合起来，migration 部署的当下就是 Cut-over 时间点本身——旧 Booking 不主动迁移（`financial_version` 一旦写入就不会再被任何代码更新），新 Booking 自动采用新版本。

### `completeLeg` 依版本分流

```ts
// driverJobs.service.ts
const booking = await tx.booking.findUniqueOrThrow({
  where: { id: updatedLeg.bookingId },
  select: { financialVersion: true }
});
if (booking.financialVersion === "V1") {
  await createLegEarning(tx, updatedLeg, actor);
}
// V2：完全不记账，收入交给 Revenue Sharing Finalize 自动处理。
```

这是唯一改动的既有代码——`completeLeg` 本身的状态机、`LEG_EARNING` 的建立逻辑（`createLegEarning`）一行都没动，只是多了一个版本判断。

## Wallet Transaction Source

沿用 Module 9 就有的 `WalletTransactionSource` 分类：`REVENUE_SHARE_PAYOUT` 的 `source` 固定是 **`BOOKING_REVENUE`**——跟 `LEG_EARNING` 一样，两者都代表「钱来自 Booking 本身的收入」，只是触发时机跟计算依据不同（`LEG_EARNING` 是 Leg 完成当下用旧 commission 算；`REVENUE_SHARE_PAYOUT` 是 Finalize 当下用新的 Revenue Sharing Rule 算）。

新增的 `WalletTransactionType`：`REVENUE_SHARE_PAYOUT`。同一张 Booking 的同一个 Leg 不会同时出现 `LEG_EARNING` 和 `REVENUE_SHARE_PAYOUT`——Financial Version 从源头上保证了这件事。

### Reference

一笔 `REVENUE_SHARE_PAYOUT` 带齐 4 个参照：

| 栏位 | 说明 |
|---|---|
| `revenueSnapshotId`（新增） | 这笔分润来自哪一笔 Revenue Sharing Snapshot。Snapshot 是 Append Only，这里只是单向参照，不会有任何代码回头去改 Snapshot |
| `bookingId` | 哪一张 Booking |
| `legId` | 哪一个 Leg（决定分配比例的依据） |
| `driverId` | 哪一个 Driver |

## Business Rules

1. Revenue Sharing Finalize 成功的**同一个 Transaction 里**，如果 Booking 是 Financial V2，就自动把 `driverPoolCents` 按每个（未取消、已指派 Driver 的）Leg 的 `earningAllocationCents` 比例分配给对应司机——沿用既有的「Revenue Allocation」概念（`earningAllocationCents`），只是套用在新的 Revenue Sharing 总额上，不是旧的 `driverPoolAmountCents`。V1 Booking 只建立 Snapshot，不发放 Wallet。
2. Company Revenue、Dispatcher Commission **不会**产生任何 Wallet Transaction——这个系统里没有「Dispatcher Wallet」的概念，Wallet 是 Driver 专属的。
3. Wallet 使用 Append Only：`createRevenueSharePayouts` 只有 `create`，没有任何 `update`/`delete` 路径；要更正只能透过既有的 Settlement Adjustment/Reversal 机制（这次没有新增任何更正路径）。
4. 用统一的「四舍五入到最近的 cent」规则算前 n-1 笔 Leg 的份额，最后一笔吃掉四舍五入后的余数，保证总和永远精确等于 `driverPoolCents`。
5. 没有任何合格 Leg（没有 Leg、或所有 Leg 都没指派 Driver、或 `earningAllocationCents` 全部是 0）时，不建立任何 Wallet Transaction——这不是错误，只是没有 Driver 可以分（Snapshot 仍然正常建立）。
6. 已取消（`CANCELLED`）的 Leg 不参与分配比例的计算。
7. **谁能执行 Finalize 不写死在 Permission 里**——`revenueSharing:finalize`（RBAC，OWNER/MANAGER 都有）只代表「有资格」；MANAGER 实际能不能 Finalize，还要看 Company Settings 的 `allowManagerFinalizeRevenueSharing` 是否开启（第一版默认关闭，等同只有 OWNER）。OWNER 永远可以 Finalize，不受这个开关影响。

## API

Finalize 沿用 [revenue-sharing-api.md](./revenue-sharing-api.md) 已有的端点，**没有新增任何端点**：

```
POST /api/admin/revenue-sharing/:bookingId/finalize
```

回传内容在原本的 Snapshot 栏位之外多了 `walletTransactions`（201）：

```json
{
  "id": 1,
  "bookingId": 1,
  "triggeredBy": "BOOKING_FINALIZED",
  "companyRevenueCents": 1500,
  "dispatcherCommissionCents": 500,
  "driverPoolCents": 8000,
  "chargeBreakdown": { "...": "..." },
  "createdAt": "2026-07-22T10:00:00.000Z",
  "walletTransactions": [
    {
      "id": 42,
      "driverId": 3,
      "bookingId": 1,
      "legId": 5,
      "revenueSnapshotId": 1,
      "transactionType": "REVENUE_SHARE_PAYOUT",
      "source": "BOOKING_REVENUE",
      "amountCents": 8000,
      "status": "PENDING"
    }
  ]
}
```

V1 Booking、没有合格 Leg 的 Booking：`walletTransactions` 是空阵列，其余栏位正常。

这次新增的 3 个查询端点（Module 12 唯一新增的 API 面）：

| Method | Path | 说明 | 需要的 Permission |
|---|---|---|---|
| `GET` | `/:bookingId/wallet` | Wallet Detail——这张 Booking 的 Snapshot Finalize 时发放了哪些 Wallet Transaction | `revenueSharing:read` |
| `GET` | `/wallet/by-driver/:driverId` | Driver Wallet——Admin 视角查看某个 Driver 收到的所有 Revenue Sharing 分润 | `revenueSharing:read` |
| `GET` | `/wallet/history?page=&pageSize=` | Wallet History——跨 Booking/Driver 的 `REVENUE_SHARE_PAYOUT` 列表，新到旧排序 | `revenueSharing:read` |

Driver 本人查看自己的 Wallet，**不需要新端点**——既有的 `GET /api/driver/wallet/transactions`、`GET /api/driver/wallet/summary`（`driverWallet:self`）本来就不分 `transactionType`，`REVENUE_SHARE_PAYOUT` 发放后会自然出现在里面。

### `GET /:bookingId/wallet` 回传

```json
{
  "bookingId": 1,
  "snapshotId": 1,
  "driverPoolCents": 8500,
  "issued": true,
  "transactions": [ { "...": "同上，附带 driver/leg/booking 展开" } ]
}
```

## Validation

| 规则 | 说明 |
|---|---|
| Snapshot 必须存在 | `GET /:bookingId/wallet` 查询还没 Finalize 过的 Booking → `404` |
| Snapshot 不允许重复发放 Wallet | Finalize 本身就不允许重复执行（Booking 已经有 Snapshot → `409`），Wallet 发放跟 Snapshot 建立是同一个 Transaction，自然不可能重复发放 |
| Wallet Transaction 不允许重复建立 | DB 层 `@@unique([legId, transactionType])`（Module 3 就有的既有约束）天然防止同一个 Leg 出现两笔 `REVENUE_SHARE_PAYOUT`——即使应用层的检查失效，这里是最后防线 |
| 所有金额必须一致 | 分配给每个 Leg 的金额加总，必须精确等于 `driverPoolCents`（用「最后一笔吃余数」的算法保证）；Finalize 本身也会先核对 Booking Total 与 Charge 实际加总是否一致，不一致就整个中止（连 Snapshot 都不建立） |
| Driver 必须存在 | 分配对象直接来自 `Leg.driverId`（FK 约束保证一定是真实存在的 Driver），不会凭空指定一个不存在的 Driver |
| 谁能 Finalize（连带谁能触发 Wallet 发放） | OWNER 永远可以；MANAGER 需要 `CompanySettings.allowManagerFinalizeRevenueSharing = true` 才放行，否则 `403` |
| Booking 必须存在 | `bookingId` 找不到对应的 Booking → `404` |

## Permission

Finalize 沿用 Module 11 既有的 `revenueSharing:finalize`（RBAC 层 OWNER/MANAGER 都有），**没有新增独立的 Issue Wallet Permission Key**——因为已经没有独立的 Issue Wallet 动作了。「MANAGER 实际能不能 Finalize」改由 Company Settings 的运行时开关决定：

| 角色 | RBAC 是否拥有 `revenueSharing:finalize` | 实际能不能 Finalize（=能不能触发 Wallet 发放） | Wallet Detail / Driver Wallet / Wallet History |
|---|:-:|:-:|:-:|
| `OWNER` | ✅ | ✅ 永远可以 | ✅ |
| `MANAGER` | ✅ | 看 `allowManagerFinalizeRevenueSharing`（默认 `false`，即第一版等同不行） | ✅ |
| `DISPATCHER` | ❌ | ❌ | ✅ |
| `DRIVER` | ❌ | ❌ | ❌（只能看自己的 Wallet） |

```ts
// revenueSharing.service.ts
function assertCanFinalize(actor: AuditActor, settings: { allowManagerFinalizeRevenueSharing: boolean }) {
  if (actor.role === "OWNER") return;
  if (actor.role === "MANAGER" && settings.allowManagerFinalizeRevenueSharing) return;
  throw new ForbiddenError(/* ... */);
}
```

`requirePermission(PERMISSIONS.REVENUE_SHARING_FINALIZE)` 这层 RBAC middleware 还是先挡住 DISPATCHER/DRIVER（他们的 RolePermission 里根本没有这个 key）；`assertCanFinalize` 是在那之后、service 层的第二道、**可配置**的关卡，只对已经通过 RBAC 的 OWNER/MANAGER 生效。未来如果要放开给 MANAGER，OWNER 到 Company Settings 把 `allowManagerFinalizeRevenueSharing` 切成 `true` 就好，不需要改代码、不需要重新部署、也不需要跑 migration 改 `role_permissions`。

## Error Code

| HTTP Status | 情境 |
|---|---|
| `400 ValidationError` | Booking Total 与 Charge 实际加总不一致；Booking 已 VOIDED |
| `403 Forbidden` | 没有 `revenueSharing:finalize`（RBAC 层）；或是 MANAGER 但 `allowManagerFinalizeRevenueSharing` 未开启（service 层） |
| `404 NotFoundError` | Booking 不存在；Snapshot 不存在（`GET /:bookingId/wallet`）；Driver 不存在（Driver Wallet 查询） |
| `409 ConflictError` | Booking 已经 FINALIZED，不能重复 Finalize（连带不会重复发放 Wallet） |

## Audit Log

| Action | 触发时机 | 内容 |
|---|---|---|
| `REVENUE_SHARING_FINALIZED` | Finalize 成功（沿用 Module 11） | `afterData` 含 Snapshot 的三个金额栏位；`metadata.rule` 记录套用的 Revenue Rule |
| `REVENUE_SHARE_PAYOUT_CREATED` | Finalize 当中每建立一笔 Wallet Transaction（V2 Booking） | `afterData` 含 driver/leg/booking/snapshot 的 id 跟金额 |

## 测试

- [`revenueSharing.calculator.test.ts`](../../apps/backend/src/modules/revenueSharing/revenueSharing.calculator.test.ts)（Unit Test）：`allocateDriverPool` 的 7 个测试——单 Leg 全拿、等权重平分、不等权重按比例、四舍五入余数正确分给最后一笔（总和精确）、没有 Leg/权重全 0 回传空阵列、`driverPoolCents=0` 时每笔金额是 0 但仍然回传每个 Leg。
- [`revenueSharing.wallet.integration.test.ts`](../../apps/backend/src/modules/revenueSharing/revenueSharing.wallet.integration.test.ts)（Integration + Permission + Duplicate Protection Test）：20 个测试，涵盖 Financial Version Cut-over 的实际行为（V1 继续 `LEG_EARNING`、V2 完全不建立）、Finalize 自动发放 Wallet 的单 Leg/多 Leg 分配、已取消 Leg 不参与、V1 Finalize 不发 Wallet、重复 Finalize 的拒绝、DB 唯一约束的 Duplicate Protection、`allowManagerFinalizeRevenueSharing` 开关的 3 种情境（默认关闭 MANAGER 被拒/开启后 MANAGER 可以/OWNER 永远不受影响）、Wallet Detail/Driver Wallet/Wallet History 三个查询、既有 Driver 自助端点自然带出新交易类型、Booking Total 不一致时整个中止。
- [`companySettings.integration.test.ts`](../../apps/backend/src/modules/companySettings/companySettings.integration.test.ts) 新增 `allowManagerFinalizeRevenueSharing` 默认值与可切换性的测试。
- Permission Test：[`permissions.test.ts`](../../apps/backend/src/common/permissions.test.ts) 断言 `DEFAULT_ROLE_PERMISSIONS` 矩阵（RBAC 层，不含 Company Settings 那层动态判断）；[`rbac.integration.test.ts`](../../apps/backend/src/modules/auth/rbac.integration.test.ts) 自动比对 DB 资料是否一致。
- 既有测试更新：[`wallet.integration.test.ts`](../../apps/backend/src/modules/wallet/wallet.integration.test.ts) 的全部 11 笔 `bookingsService.createBooking` 调用补上 `financialVersion: "V1"`——这个档案测的正是 Module 3 的旧机制，明确标记成 V1 才符合 Migration Cut-over「旧 Booking 不主动迁移」的设计，也确保这些既有测试在新的 Cut-over 默认值（V2）之下仍然验证的是它们原本要测的行为。

## 已知限制

- **Settlement 还没有整合**——`REVENUE_SHARE_PAYOUT` 目前只是 `PENDING` 状态躺在 Wallet 里，日结（Daily Settlement）机制本身没有改动，能不能正常把这批新交易结算掉沿用既有逻辑（理论上可以，因为 Settlement 本来就是「捞出所有 PENDING 的 WalletTransaction」，不分 transactionType），但没有专门针对这个新类型写 Settlement 层级的测试，用户明确要求这次不开始 Settlement。
- **没有「Re-issue」或「补发」流程**——Finalize 只能成功一次；如果 Leg 分配比例事后发现算错，目前没有设计任何更正路径（既有的 Manual Adjustment 可以手动补差额，但不是这个 Module 专属设计的机制）。
- **没有 Approve 步骤**——用户已经明确未来的方向是 `Preview → Approve → Finalize`，这次只做了业务流程从「Finalize + 手动 Issue Wallet」简化成「Finalize 自动发放」，`Approve` 本身完全没有实作，Finalize 目前是 Preview 之后唯一能做的下一步。
- **`allowManagerFinalizeRevenueSharing` 是唯一一个开关，没有更细的粒度**——例如没办法只放开「Finalize 但不自动发 Wallet」给 MANAGER，两者绑在一起。如果未来需要这种细粒度，要另外设计。
- **Dispatcher Commission 完全没有对应的 Wallet 机制**——这个系统没有 Dispatcher Wallet 的概念，`dispatcherCommissionCents` 只停留在 Snapshot 里，如何实际发放给 Dispatcher（如果需要）留给未来。
- **没有 HTTP 层级的自动化测试**、**Frontend 完全未开发**，延续本专案既有做法。
