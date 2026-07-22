# Module 10: Booking Charge API（Financial API Phase 1）

> 承接 [financial-model-v2.md](../design/financial-model-v2.md) 与 [database-schema-v2.md](../design/database-schema-v2.md)。这次只开发 Booking Charge 的 Backend API，**没有 Trip Expense/Revenue Sharing/Collection/Wallet API，也没有 Frontend**。

## 概念

`BookingCharge` 记录客户应该支付的每一笔费用，独立 Ledger，Append Only——没有 UPDATE/DELETE，写错了只能新增新记录来更正：

- **原始 Charge**（`adjustmentType = NONE`）：第一次记录这笔费用。
- **补收**（`adjustmentType = ADDITION`）：金额不够，另外再收一笔，`adjustsChargeId` 指回原始 Charge。
- **冲销**（`adjustmentType = REVERSAL`）：透过 `POST /:id/void` 建立，金额是原始 Charge 的相反数，`adjustsChargeId` 指回原始 Charge。**Void 不删除、不修改任何资料，只是新增一笔冲销纪录**——原始 Charge 的 `amountCents`/`adjustmentType` 永远保持建立时的样子。

`Booking.totalAmountCents`（Customer Total）= 这张 Booking 底下**全部** BookingCharge 金额的加总（原始 + 补收 + 冲销），冲销的负数会自然抵销，不需要额外排除任何记录。每次 Create/Void 都会在同一个 DB Transaction 里重新算一次，写回 `bookings.total_amount_cents`。

## API

Base path：`/api/admin/booking-charges`，全部需要先登入（`requireAuth`）。

| Method | Path | 说明 | 需要的 Permission |
|---|---|---|---|
| `POST` | `/` | Create——不带 `adjustsChargeId` 建立原始 Charge，带了就是补收（ADDITION） | `bookingCharge:write` |
| `GET` | `/?bookingId=` | List——这张 Booking 目前的净额视图（一笔原始 Charge 一行，含净额/是否已冲销） | `bookingCharge:read` |
| `GET` | `/:id` | Detail——单笔 Charge 的完整原始资料 | `bookingCharge:read` |
| `GET` | `/:id/history` | History——这笔 Charge 的完整生命周期（原始 + 所有补收/冲销，依时间排序） | `bookingCharge:read` |
| `POST` | `/:id/void` | Void——建立一笔冲销记录，`{ reason }` 必填 | `bookingCharge:void` |

### `POST /` 请求 Body

```json
{
  "bookingId": 1,
  "legId": 2,                 // 可选，归属到特定 Leg
  "chargeTypeId": 3,
  "amountCents": 10000,
  "description": "机场接送",    // 可选
  "adjustsChargeId": 5,       // 可选，提供了就是补收（ADDITION）
  "adjustmentReason": "客户补收停车费差额"  // adjustsChargeId 存在时必填
}
```

回传 `201` + 建立的 Charge（含 `chargeType`/`createdByUser` 展开）。

### `GET /?bookingId=` 回传

每笔原始 Charge 一个物件，额外带三个衍生栏位：

```json
[
  {
    "id": 5,
    "bookingId": 1,
    "amountCents": 10000,
    "adjustmentType": "NONE",
    "chargeType": { "id": 3, "key": "FARE", "label": "车资" },
    "netAmountCents": 10500,
    "isVoided": false,
    "additionCount": 1
  }
]
```

`netAmountCents` = 原始金额 + 所有指向它的补收/冲销加总；`isVoided` = 是否有一笔冲销记录指向它。

### `POST /:id/void` 请求 Body

```json
{ "reason": "客户取消这笔额外服务" }
```

回传 `201` + 建立的冲销记录（`adjustmentType: "REVERSAL"`，`amountCents` 是原始金额的相反数）。

## Business Rules

1. **Booking Total 自动根据有效 Charge 汇总**——Create/Void 都在同一个 Transaction 里重新计算 `SUM(booking_charges.amount_cents)`，写回 `bookings.total_amount_cents`。
2. **Customer Total = 所有有效 Charge 合计**——冲销记录用负数金额自然抵销，不需要额外的「排除已冲销」逻辑。
3. **Void 不删除资料，只新增一笔冲销记录**——原始 Charge 永远保持建立时的原样。
4. **Adjustment 不修改历史 Charge**——补收/冲销都是新记录，`adjustsChargeId` 指回原始 Charge，原始 Charge 本身不会被碰。
5. **补收（ADDITION）只能对原始 Charge（NONE）建立**，不能对另一笔补收/冲销再建立补收（避免链式调整让追溯变复杂）。
6. **同一笔原始 Charge 最多只能被冲销一次**——DB 层的 Partial Unique Index 保证，Backend 会先查一次给出更清楚的 409 错误，而不是让请求方直接看到 DB 约束错误。
7. **所有 Create/Void 动作都写 Audit Log**（`BOOKING_CHARGE_CREATED`/`BOOKING_CHARGE_VOIDED`），固定包含操作人、时间、变更内容。
8. **建立/冲销 Charge 时会锁住对应的 Booking row**（`SELECT ... FOR UPDATE`），避免两个并发请求各自算出一份「重算前」的 Booking Total、互相覆盖对方的结果。

## Validation

| 规则 | 说明 |
|---|---|
| 金额必须大于 0（Adjustment 除外） | 原始 Charge（`adjustmentType=NONE`）的 `amountCents` 必须 `> 0`；补收/冲销只要求不能是 `0`（冲销的金额由系统自动算出，固定是原始金额的相反数） |
| Charge Type 必须合法 | `chargeTypeId` 必须存在，而且 `active = true`——停用的分类不能拿来建新 Charge，但不影响历史资料 |
| 已 FINALIZED 的 Booking 不允许修改原始 Charge | 系统本来就没有任何 UPDATE Charge 的 API，这条规则永远成立 |
| 已 FINALIZED 只能新增 ADDITION 或 REVERSAL Adjustment | Booking `financialStatus = FINALIZED` 时，`POST /` 如果没带 `adjustsChargeId`（代表要建立原始 Charge）会被拒绝；带了 `adjustsChargeId`（补收）或走 `POST /:id/void`（冲销）都不受影响 |
| 所有金额使用 integer cents | 沿用全系统一致的做法，没有任何 Decimal/Float |
| `legId` 必须属于同一张 Booking | 传了 `legId` 但那个 Leg 不存在、或属于别的 Booking，会被拒绝 |
| `adjustsChargeId` 必须存在、属于同一张 Booking、而且是原始 Charge | 三个条件都要满足，缺一不可 |
| 补收（ADDITION）必须填 `adjustmentReason` | 冲销（Void）的 `reason` 也是必填 |
| 不能 Void 一笔 REVERSAL 记录本身 | 冲销记录已经是「更正」，不需要再被冲销 |

## Permission

| 角色 | Create | View（List/Detail/History） | Void |
|---|:-:|:-:|:-:|
| `OWNER` | ✅ | ✅ | ✅ |
| `MANAGER` | ✅ | ✅ | ✅ |
| `DISPATCHER` | ✅ | ✅ | ❌ |
| `DRIVER` | ❌ | ❌ | ❌ |

三个新增的 Permission Key：`bookingCharge:read`、`bookingCharge:write`、`bookingCharge:void`（[migration](../../apps/backend/prisma/migrations/20260806000000_booking_charge_permissions/migration.sql) 已经把对应的 `role_permissions` 资料灌好，纯资料操作，不需要改任何业务逻辑）。跟既有的 `booking:read`/`booking:write` 是分开的两组 key——Dispatcher 在 Booking Charge 这边刻意比 `booking:write` 更细，能 Create/View 但不能 Void。

## Error Code

| HTTP Status | 情境 |
|---|---|
| `400 ValidationError` | 金额不合法、Charge Type 不合法/停用、FINALIZED Booking 尝试建立原始 Charge、补收/冲销缺少必填的 reason、`adjustsChargeId` 指向非原始 Charge、试图 Void 一笔 REVERSAL |
| `403 Forbidden` | 没有对应的 Permission（由 `requirePermission` middleware 统一处理，不是 controller 自己抛的） |
| `404 NotFoundError` | Booking / BookingCharge / Leg / `adjustsChargeId` 指向的记录不存在，或不属于同一张 Booking |
| `409 ConflictError` | 这笔 Charge 已经被冲销过，重复 Void |

## Audit Log

| Action | 触发时机 | 内容 |
|---|---|---|
| `BOOKING_CHARGE_CREATED` | 建立原始 Charge 或 ADDITION | `afterData` 含完整栏位；`metadata.bookingTotalAmountCentsAfter` 记录重算后的 Booking Total |
| `BOOKING_CHARGE_VOIDED` | Void 成功 | `beforeData` 记录被冲销的原始 Charge 资讯，`afterData` 记录新建立的冲销记录 |

## 测试

- [`bookingCharge.aggregation.test.ts`](../../apps/backend/src/modules/bookingCharges/bookingCharge.aggregation.test.ts)（Unit Test）：`computeNetAmountCents`/`isChargeVoided`/`buildChargeListView`/`sumBookingTotalCents` 四个纯函数，10 个测试，不碰 DB。
- [`bookingCharge.integration.test.ts`](../../apps/backend/src/modules/bookingCharges/bookingCharge.integration.test.ts)（Integration + Validation Test）：真实 Postgres，27 个测试，涵盖 Create/List/Detail/Void/History 的成功路径、上面列出的每一条 Validation 规则、Booking Total 重算正确性、Audit Log 写入。
- Permission Test：[`permissions.test.ts`](../../apps/backend/src/common/permissions.test.ts) 断言 `DEFAULT_ROLE_PERMISSIONS` 矩阵符合本文件的 Permission 表；[`rbac.integration.test.ts`](../../apps/backend/src/modules/auth/rbac.integration.test.ts) 是既有的通用测试，会自动比对 DB 里 `role_permissions` 的实际资料跟 `DEFAULT_ROLE_PERMISSIONS` 是否一致，不需要为这次新增的 3 个 key 另外写专属测试。

## 已知限制

- **既有 Booking 建立流程还没有整合**：`bookings.service.ts` 的 `createBooking`/`updateBooking` 目前还是走旧的 `totalAmountCents` 直接输入，没有改成透过 Booking Charge 建立初始 Fare——这次刻意不动既有 Booking API，避免超出「只开发 Booking Charge API」的范围。对已经用旧流程建立、目前还没有任何 BookingCharge 的 Booking，第一次透过这支新 API 新增 Charge 时，`totalAmountCents` 会被覆写成只反映新 Charge 的加总，不会保留旧的数值——这是预期中的过渡状态。
- **`platformAmountCents`/`driverPoolAmountCents` 没有被这次的 API 更新**——这两个栏位的重算需要套用 Revenue Sharing 的拆分逻辑（`ChargeType.participatesInRevenueSharing`/`isCompanyRevenue`），属于下一阶段的 Revenue Sharing API，这次刻意不做。
- **Multi-Leg Driver Pool 的并发保护还没有实作**——`earningAllocationCents` 依然沿用 Module 3 的既有机制，这次的 Booking Charge API 不会影响、也不会检查 Leg 分配是否超过 Driver Pool（那是 Revenue Sharing API 阶段的工作）。
- **没有 HTTP 层级的自动化测试**（例如 supertest）——这个专案从 Module 1 到现在都是在 Service 层直接测试（真实 Postgres + Prisma Client），Permission 验证走 RBAC 资料层测试，没有引入新的测试工具，维持跟既有模块一致的做法。
- **Frontend 完全未开发**，包含 Permission Key 尚未同步到前端的 `common/permissions.ts` 镜像檔案。
