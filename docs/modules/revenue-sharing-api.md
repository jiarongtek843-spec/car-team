# Module 11: Revenue Sharing API（Financial API Phase 2）

> 承接 [financial-model-v2.md](../design/financial-model-v2.md)、[database-schema-v2.md](../design/database-schema-v2.md)、[booking-charge-api.md](./booking-charge-api.md) 和 [booking.md](./booking.md#booking-charge-整合financial-model-v2)。这次开发的是 Revenue Sharing 的计算、Snapshot 与查询 API，**没有 Trip Expense/Collection/Wallet API，也没有 Frontend**，也没有把既有的 Wallet/Settlement 迁移过来使用这套新的分润结果（那是之后的 Wallet Migration）。

## Revenue Rule

Revenue Rule 完全来自 [Company Settings](./company-settings.md)（单例设定表），这次新增 4 个栏位：

| 栏位 | 说明 | 默认值 |
|---|---|---|
| `companyCommissionType` | `PERCENTAGE` \| `FIXED_AMOUNT` | `PERCENTAGE` |
| `companyCommissionValue` | PERCENTAGE 时是整数百分比；FIXED_AMOUNT 时是 cents | `15` |
| `dispatcherCommissionType` | `PERCENTAGE` \| `FIXED_AMOUNT` | `PERCENTAGE` |
| `dispatcherCommissionValue` | 同上 | `0` |

**Driver Pool 没有独立栏位**——定义上就是「参与分润的 Charge 总额」扣掉 Company Commission 和 Dispatcher Commission 之后的余额，不需要另外配置。Company Commission 和 Dispatcher Commission 各自独立、平行地对参与分润的总额计算（不是依序从余额里扣），两者的计算互不影响。

未来如果要新增第三种 Commission（例如 Referral Commission）：比照这两组栏位的模式在 `CompanySettings` 加两个栏位（`xxxCommissionType`/`xxxCommissionValue`），在 [`revenueSharing.calculator.ts`](../../apps/backend/src/modules/revenueSharing/revenueSharing.calculator.ts) 的 `RevenueRuleConfig`/`calculateRevenueSharing` 里多算一个分量、多加一笔 `ruleBreakdown`——**不需要改动 Preview/Finalize 的 API 形状、Validation 规则或 Snapshot 的写入逻辑本身**，这就是「未来可以新增更多 Rule，不需要修改业务逻辑」的具体做法。

## Charge Type 分桶

Revenue Sharing 只根据 Booking 底下**所有有效的 Booking Charge**（原始 + ADDITION + REVERSAL 全部一起加总，REVERSAL 本身是负数会自然抵销）计算，不看 Trip Expense、Collection 或任何其他资料来源。每一笔 Charge 依照它的 `ChargeType` 的两个既有 flag（`participatesInRevenueSharing`/`isCompanyRevenue`，见 [booking-charge-api.md](./booking-charge-api.md)）分进三个桶：

| `participatesInRevenueSharing` | `isCompanyRevenue` | 归属 | 是否套用 Company/Dispatcher Commission |
|:-:|:-:|---|:-:|
| `true` | （不生效） | 参与分润总额 | ✅ |
| `false` | `true` | 全额算 Company Revenue | ❌ |
| `false` | `false` | 全额算 Driver 收入 | ❌ |

例如目前 Seed 的 4 个 Charge Type：`FARE`/`SURCHARGE`/`EXTRA_SERVICE` 参与分润；`PERSONAL_TIP` 不参与、直接全额算 Driver 收入。新增 Charge Type（例如未来的 Airport Fee）只需要在 `charge_types` 表配置这两个 flag，不需要改这个 Module 的任何程式码。

## Snapshot

`RevenueSharingSnapshot` 表在 [Financial Model v2 Schema](./booking-charge-api.md) 阶段就已经建好，这次扩充了一个栏位（`dispatcherCommissionCents`）并第一次真正被写入：

- **唯一触发时机**：Booking 的 `financialStatus` 进入 `FINALIZED` 的当下（`POST /:bookingId/finalize`），且**只会触发一次**——`bookingId` 是 `@unique`，DB 层保证一张 Booking 最多一笔 Snapshot。
- **写入后永不修改**：整个 Codebase 里对 `RevenueSharingSnapshot` 只有一个 `create` 调用（在 `finalizeRevenueSharing` 里），没有任何 `update`/`delete` 路径。
- **Company Settings 之后修改不会影响历史 Snapshot**——Revenue Rule 是在 Finalize 当下读取、算完就写死进 Snapshot 的三个金额栏位，不是引用，之后 Company Settings 改了跟这笔 Snapshot 完全无关。
- **Adjustment Charge 不会自动修改旧 Snapshot**——FINALIZED 之后仍然可以对已有的 Charge 建立 ADDITION/REVERSAL（Booking Charge API 本身就允许），但不会有任何代码去重新计算或覆写已经存在的 Snapshot；如果要反映新的 Adjustment，必须是未来某个显式的「Re-open / 补充分润」流程（目前没有，见已知限制）。
- `chargeBreakdown`（Json）記录的是 Finalize 当下的完整明细：每个 ChargeType 的加总金额、套用的 Revenue Rule 明细（type/value/算出来的金额）、参与分润总额，供审计/追溯用。

## Business Rules

1. Revenue Sharing 只根据「有效的 Booking Charges」计算——Preview/Finalize 都会先确认这张 Booking 至少有一笔 Charge，没有就拒绝。
2. 只有 `chargeType.participatesInRevenueSharing = true` 的 Charge 才会套用 Company/Dispatcher Commission；其余的依 `isCompanyRevenue` 全额归类，不打折扣。
3. 所有金额使用 integer cents，PERCENTAGE 计算统一用全系统共用的「四舍五入到最近的 cent」规则（`roundToNearestCent`）。
4. Finalize 之前会重新核对 `Booking.totalAmountCents`（快取栏位）跟 Booking Charge 实际加总是否一致——不一致就中止，不会用一个已经跟实际资料脱钩的数字去产生 Snapshot。
5. Finalize 成功后，`Booking.financialStatus` 从 `OPEN`/`ACCRUING` 收敛成 `FINALIZED`；已经是 `FINALIZED` 或 `VOIDED` 的 Booking 都不能再 Finalize。
6. Preview 是纯计算、零副作用，任何 `financialStatus` 都可以重复调用，不受「已经 Finalize 过」的限制——方便在 Finalize 之前反复确认数字，也方便事后查看「如果照现在的设定重算会长怎样」（但不会覆盖已经存在的 Snapshot）。
7. 所有 Finalize 动作都写 Audit Log（`REVENUE_SHARING_FINALIZED`），固定包含操作人、时间、算出来的三个金额跟当下套用的 Revenue Rule。
8. Finalize 会锁住对应的 Booking row（`SELECT ... FOR UPDATE`），避免两个并发请求各自算出一份、都尝试建立 Snapshot（DB 的 `bookingId` unique 约束是最后防线）。

## API

Base path：`/api/admin/revenue-sharing`，全部需要先登入（`requireAuth`）。

| Method | Path | 说明 | 需要的 Permission |
|---|---|---|---|
| `POST` | `/:bookingId/preview` | Preview——纯计算，不建立 Snapshot、不改 Booking 状态 | `revenueSharing:preview` |
| `POST` | `/:bookingId/finalize` | Finalize——建立 Snapshot，把 Booking 收敛成 FINALIZED | `revenueSharing:finalize` |
| `GET` | `/:bookingId` | Revenue Snapshot——单一 Booking 已经 Finalize 的结果 | `revenueSharing:read` |
| `GET` | `/?page=&pageSize=` | Revenue History——跨 Booking 的 Snapshot 列表，新到旧排序 | `revenueSharing:read` |

### `POST /:bookingId/preview` / `POST /:bookingId/finalize` 回传

```json
{
  "bookingId": 1,
  "financialStatus": "OPEN",
  "participatingAmountCents": 12000,
  "nonParticipatingCompanyCents": 0,
  "nonParticipatingDriverCents": 500,
  "companyCommissionCents": 1800,
  "dispatcherCommissionCents": 600,
  "companyRevenueCents": 1800,
  "driverPoolCents": 10100,
  "chargeBreakdown": [
    { "chargeTypeKey": "FARE", "amountCents": 10000, "participatesInRevenueSharing": true, "isCompanyRevenue": false },
    { "chargeTypeKey": "SURCHARGE", "amountCents": 2000, "participatesInRevenueSharing": true, "isCompanyRevenue": false },
    { "chargeTypeKey": "PERSONAL_TIP", "amountCents": 500, "participatesInRevenueSharing": false, "isCompanyRevenue": false }
  ],
  "ruleBreakdown": [
    { "key": "COMPANY_COMMISSION", "type": "PERCENTAGE", "value": 15, "amountCents": 1800 },
    { "key": "DISPATCHER_COMMISSION", "type": "PERCENTAGE", "value": 5, "amountCents": 600 }
  ],
  "rule": {
    "companyCommissionType": "PERCENTAGE",
    "companyCommissionValue": 15,
    "dispatcherCommissionType": "PERCENTAGE",
    "dispatcherCommissionValue": 5
  }
}
```

`POST /:bookingId/preview` 回传上面这个完整计算结果（`201` 状态码不适用，是 `200`）；`POST /:bookingId/finalize` 回传 `201` + 实际写入的 `RevenueSharingSnapshot`（`id`/`bookingId`/`triggeredBy`/`companyRevenueCents`/`dispatcherCommissionCents`/`driverPoolCents`/`chargeBreakdown`/`createdAt`，没有 `financialStatus`/`rule`/`ruleBreakdown` 这些 Preview 才有的衍生栏位，因为它们已经内嵌进 `chargeBreakdown` 里）。

### `GET /:bookingId` 回传

跟 Finalize 的回传一样是 `RevenueSharingSnapshot` 本身；这张 Booking 还没 Finalize 过时回 `404`。

### `GET /?page=&pageSize=` 回传

```json
{
  "data": [
    {
      "id": 1,
      "bookingId": 1,
      "triggeredBy": "BOOKING_FINALIZED",
      "companyRevenueCents": 1800,
      "dispatcherCommissionCents": 600,
      "driverPoolCents": 10100,
      "chargeBreakdown": { "...": "..." },
      "createdAt": "2026-07-22T10:00:00.000Z",
      "booking": { "id": 1, "girlName": "Yoyo", "totalAmountCents": 12500 }
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

## Validation

| 规则 | 说明 |
|---|---|
| Booking 必须存在 | `bookingId` 找不到对应的 Booking → `404` |
| Booking 必须有有效 Charge | 一笔 BookingCharge 都没有 → `400`（Preview/Finalize 都检查） |
| Snapshot 不允许重复 Finalize | 这张 Booking 已经有 Snapshot → `409` |
| 已 Finalized 不允许重新计算 | `Booking.financialStatus = FINALIZED` 时再 Finalize → `409`（跟上一条本质是同一件事的两个检查点，`409` 讯息不同） |
| Booking 已取消不能 Finalize | `Booking.financialStatus = VOIDED` 时 Finalize → `400` |
| 所有金额必须一致 | Finalize 前重新核对 `Booking.totalAmountCents` 跟 Booking Charge 实际加总，不一致 → `400`（正常流程不会触发，属于资料完整性防线） |
| Revenue Allocation 总额不能超过可分配金额 | `companyCommissionCents + dispatcherCommissionCents > participatingAmountCents` → `400` |
| 所有金额使用 integer cents | 沿用全系统一致的做法 |

Company Settings 更新时也有一条相关的 Validation（写在 [company-settings.md](./company-settings.md)）：`companyCommissionType`/`dispatcherCommissionType` 都是 `PERCENTAGE` 时，两个百分比加总不能超过 100%——混了 `FIXED_AMOUNT` 的组合没办法在设定当下判断超额，那是要看实际 Booking 总额的事，交给 Preview/Finalize 当下的 Validation 处理。

## Permission

| 角色 | Preview | Finalize | View（Snapshot/History） |
|---|:-:|:-:|:-:|
| `OWNER` | ✅ | ✅ | ✅ |
| `MANAGER` | ✅ | ✅ | ✅ |
| `DISPATCHER` | ❌ | ❌ | ✅ |
| `DRIVER` | ❌ | ❌ | ❌ |

三个新增的 Permission Key：`revenueSharing:read`、`revenueSharing:preview`、`revenueSharing:finalize`（[migration](../../apps/backend/prisma/migrations/20260808000000_revenue_sharing_permissions/migration.sql) 已经把对应的 `role_permissions` 资料灌好）。Dispatcher 在这个 Module 是纯 View Only——连 Preview 都不给，跟 Booking Charge（Dispatcher 能 Create/View）的授权哲学不一样，因为 Revenue Sharing 属于「营运结果」而不是「营运操作」。

> **Module 12 更新**：上表的「MANAGER Finalize = ✅」只反映 RBAC 层的静态权限（还有没有这个资格）。Finalize 现在同时代表「自动发放 Wallet」，因此实际能不能执行还多了一层由 `CompanySettings.allowManagerFinalizeRevenueSharing` 控制的运行时开关（第一版默认关闭，等同只有 OWNER），细节见 [wallet-migration.md](./wallet-migration.md#permission)。

## Error Code

| HTTP Status | 情境 |
|---|---|
| `400 ValidationError` | Booking 没有 Charge、Booking 已 VOIDED、金额不一致、Revenue Allocation 总额超过可分配金额 |
| `403 Forbidden` | 没有对应的 Permission（由 `requirePermission` middleware 统一处理） |
| `404 NotFoundError` | Booking 不存在；`GET /:bookingId` 查询还没 Finalize 过的 Booking |
| `409 ConflictError` | 这张 Booking 已经有 Snapshot；Booking 已经 FINALIZED |

## Audit Log

| Action | 触发时机 | 内容 |
|---|---|---|
| `REVENUE_SHARING_FINALIZED` | Finalize 成功 | `afterData` 含 `bookingId`/三个金额栏位；`metadata.rule` 记录当下套用的 Revenue Rule 设定 |

## 测试

- [`revenueSharing.calculator.test.ts`](../../apps/backend/src/modules/revenueSharing/revenueSharing.calculator.test.ts)（Unit Test）：`computeComponentCents`/`calculateRevenueSharing` 两个纯函数，11 个测试，涵盖三个分桶的归类、PERCENTAGE/FIXED_AMOUNT 计算、同一 ChargeType 多笔合并、超额拒绝、空 Charge 列表、恰好用完 Driver Pool 的边界情况，不碰 DB。
- [`revenueSharing.integration.test.ts`](../../apps/backend/src/modules/revenueSharing/revenueSharing.integration.test.ts)（Integration + Snapshot + Validation Test）：真实 Postgres，17 个测试，涵盖 Preview/Finalize 的成功路径、上面列出的每一条 Validation 规则、Snapshot 建立后不受 Adjustment Charge 或 Company Settings 之后修改影响（Append Only 的具体验证）、History/Snapshot 查询。
- [`companySettings.integration.test.ts`](../../apps/backend/src/modules/companySettings/companySettings.integration.test.ts) 新增 4 个测试，验证新的 Revenue Rule 栏位的读写与 `assertRevenueRuleSane` 这条 Validation（含合并后校验，不是只看这次请求传了什么）。
- Permission Test：[`permissions.test.ts`](../../apps/backend/src/common/permissions.test.ts) 断言 `DEFAULT_ROLE_PERMISSIONS` 矩阵符合本文件的 Permission 表；[`rbac.integration.test.ts`](../../apps/backend/src/modules/auth/rbac.integration.test.ts) 是既有的通用测试，会自动比对 DB 里 `role_permissions` 的实际资料跟 `DEFAULT_ROLE_PERMISSIONS` 是否一致，不需要为这次新增的 3 个 key 另外写专属测试。

## 已知限制

- **Wallet 已经在 Module 12（Wallet Migration）整合，而且是自动的**——Finalize 成功的同一个 Transaction 里就会把 `driverPoolCents` 按 Leg 分配比例发放成 `WalletTransaction`（Financial V2 Booking），不需要额外的手动步骤，细节见 [wallet-migration.md](./wallet-migration.md)。`companyRevenueCents`/`dispatcherCommissionCents` 仍然只停留在 Snapshot——这个系统没有 Company/Dispatcher Wallet 的概念。**Settlement 还没有整合**，沿用既有的日结机制。「谁能执行 Finalize」也在 Module 12 变成可配置（`CompanySettings.allowManagerFinalizeRevenueSharing`），不再单纯由这里的 RBAC 权限表决定——细节同样见 wallet-migration.md。
- **Finalize 不检查 Booking 的营运状态（`status`）**——目前是纯手动触发的动作，不要求 Leg 全部 COMPLETED 才能 Finalize，也不会因为 Leg 完成而自动触发 Finalize。`financial-model-v2.md` 里「FINALIZED 对应营运面 status 变成 COMPLETED」的完整状态机联动，留给未来的自动化。
- **没有「Re-open」或「重新计算」流程**——Snapshot 一旦建立，这个 Module 没有提供任何方式去撤销或更新它；如果 Finalize 之后发现 Revenue Rule 设错了，只能透过之后的 Adjustment Charge + 未来某个「补充分润」的新流程处理（本次不设计）。
- **History 列表没有日期区间/角色相关的筛选**，只支援分页——报表需求如果需要更细的筛选条件，留给未来的 Reporting 需求驱动。
- **没有 HTTP 层级的自动化测试**（例如 supertest），延续本专案从 Module 1 开始的既有做法（Service 层直接测试 + Permission 走 RBAC 资料层测试）。
- **Frontend 完全未开发**。
