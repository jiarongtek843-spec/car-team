# Database Schema v2 — ER 设计文件（第二版，已定案）

> **状态：ER 设计定案，即将进入 Prisma Schema + Migration 实作。** 承接 [financial-model-v2.md](financial-model-v2.md) 已确认的业务规则，这份文件回答「有哪些表、表之间怎么关联、每张表的主键/外键/索引/删除策略是什么」。本次更新处理了第一版遗留的 4 个未确认细节（Charge Type Seed、Financial Status Backfill、Adjustment Charge 标记、Multi-Leg Driver Pool），全部已定案。

## 设计原则对照

| 你要求的原则 | 这份设计怎么落实 |
|---|---|
| 1. 面向 3–5 年可扩充 | `ChargeType` 是数据表不是 enum；`Company`/多币种预留栏位（见「延伸性预留」章节）；所有新表都用独立自增 PK，不用複合自然键 |
| 2. 每张 Financial Table 都要有明确 PK/FK/索引/删除策略 | 见第 5 章「关联与删除策略总表」，逐表列出 |
| 3. 所有金额 integer cents | 全部新栏位延续既有命名习惯 `xxxAmountCents`，没有任何 Decimal/Float |
| 4. Financial Record Append Only | 见第 6 章，逐表说明「没有 UPDATE/DELETE API」的具体落实方式 |
| 5. 需要保留历史的资料要有 Audit + Traceability | 每张新 Financial Table 都有 `createdBy`/`createdAt`，重要状态转换都有对应的 `xxxAt`/`xxxBy` 栏位，并且会写 `audit_logs`（沿用既有机制）；第 9 章新增 `booking_charge_id` 补齐 Wallet Transaction 的追溯链路 |
| 6. 尽量避免 Breaking Migration | 见第 7 章，说明为什么这次没有删除/改名任何既有栏位，全部是新增 |

---

## 1. Database ER Diagram（文字版）

### 1.1 高层关系图（概念层级）

```
┌──────────┐        ┌──────────┐
│   User    │        │   Role    │──▶ RolePermission
└────┬─────┘        └──────────┘
     │ createdBy / actorUserId（Restrict）散布在下面几乎所有表

┌──────────────────────────── Booking ────────────────────────────┐
│                                                                    │
│   Booking ──1:N──▶ Leg                                            │
│      │                │                                           │
│      │                └──1:N──▶ BookingCharge（legId 可选）        │
│      │                                                             │
│      ├──1:N──▶ BookingCharge（bookingId 必填）                     │
│      │              │                                              │
│      │              ├──N:1──▶ ChargeType（chargeTypeId）           │
│      │              └──0:N──▶ BookingCharge（adjustsChargeId，自关联，│
│      │                         ADDITION 可多笔、REVERSAL 只能一笔）  │
│      │                                                             │
│      ├──1:N──▶ TripExpense（bookingId 必填，legId 可选）            │
│      │              └──0:1──▶ TripExpense（reversesExpenseId，自关联）│
│      │                                                             │
│      └──0:1──▶ RevenueSharingSnapshot（bookingId 唯一）             │
│                                                                    │
└────────────────────────────────────────────────────────────────┘

┌──────────────────────────── Driver ─────────────────────────────┐
│                                                                    │
│   Driver ──1:N──▶ WalletTransaction ──0:1──▶ Leg（legId，既有）     │
│      │                  │             ──0:1──▶ TripExpense（tripExpenseId，新增）│
│      │                  │             ──0:1──▶ BookingCharge（bookingChargeId，新增，追溯用）│
│      │                  │             ──0:1──▶ Settlement（settlementId，既有）│
│      │                  │             ──0:1──▶ Settlement（relatedSettlementId，既有）│
│      │                                                             │
│      └──1:N──▶ Collection ──0:1──▶ Leg（legId，既有）               │
│                    │        ──0:1──▶ BookingCharge（relatedChargeId，新增，单向）│
│                    │        ──0:1──▶ Collection（parentCollectionId，新增，自关联）│
│                    └────────0:1──▶ Settlement（settlementId，既有）  │
│                                                                    │
└────────────────────────────────────────────────────────────────┘

Settlement ──1:N──▶ SettlementItem ──1:1──▶ WalletTransaction（既有，不变）

CompanySettings（单例表，既有，不变）
AuditLog（既有，不变，记录以上全部表的变更）
```

### 1.2 Booking Charge / Revenue Sharing 关系细节（含 Adjustment）

```
Booking (financialStatus: OPEN → ACCRUING → FINALIZED / VOIDED)
   │
   ├─▶ BookingCharge（adjustmentType = NONE，原始 Charge）──▶ ChargeType
   │        │
   │        ├─▶ BookingCharge（adjustmentType = ADDITION，adjustsChargeId 指回原始，可多笔）
   │        └─▶ BookingCharge（adjustmentType = REVERSAL，adjustsChargeId 指回原始，最多一笔）
   │
   └─▶ RevenueSharingSnapshot（只在 financialStatus → FINALIZED 时新增一笔，bookingId 唯一，
        之后新增的 ADDITION/REVERSAL 不会触发重新计算或覆写这笔快照）
```

### 1.3 Trip Expense / Wallet Reimbursement 关系细节

```
TripExpense (status: PENDING → VERIFIED/REJECTED → REIMBURSED/VOIDED)
   │
   └─▶ WalletTransaction（source=TRIP_EXPENSE，tripExpenseId 唯一）
            │
            └─▶ SettlementItem ──▶ Settlement
```

### 1.4 Partial Collection 关系细节

```
Collection（第一笔，parentCollectionId = null，expectedAmountCents = 应收总额）
   │
   ├─▶ Collection（第二笔分期，parentCollectionId 指回第一笔）
   ├─▶ Collection（第三笔分期，parentCollectionId 指回第一笔）
   └─▶ …

Received = SUM(第一笔.amountCents + 所有子记录.amountCents)
Outstanding = 第一笔.expectedAmountCents − Received
```

### 1.5 Multi-Leg Driver Pool 关系细节

```
Booking
  │
  ├─▶ BookingCharge[]（所有未冲销的，含 ADDITION/REVERSAL）
  │        │
  │        ▼（即时 Revenue Sharing 计算）
  │     driverPoolCents（整张 Booking 共用同一个上限）
  │
  ├─▶ Leg A（去程，Driver A）── earningAllocationCents_A ──▶ LEG_EARNING（source=BOOKING_REVENUE）
  ├─▶ Leg B（回程，Driver B）── earningAllocationCents_B ──▶ LEG_EARNING（source=BOOKING_REVENUE）
  └─▶ …

约束：SUM(所有未取消 Leg 的 earningAllocationCents) ≤ driverPoolCents
```

---

## 2. 完整 Table 清单

### 2.1 新增（4 张）

| Table | 对应 Financial Model 章节 |
|---|---|
| `charge_types` | 第 4 章 Booking Charge |
| `booking_charges` | 第 4 章 Booking Charge |
| `trip_expenses` | 第 5 章 Trip Expense |
| `revenue_sharing_snapshots` | 第 7 章 Revenue Sharing Snapshot |

### 2.2 既有表，需要新增栏位（3 张，全部是 Additive，不删改任何既有栏位）

| Table | 新增栏位 |
|---|---|
| `bookings` | `financial_status`（enum，新增） |
| `wallet_transactions` | `source`（enum，新增）、`trip_expense_id`（可选 FK，新增）、`booking_charge_id`（可选 FK，新增，追溯用）；`transaction_type` enum 新增一个值 `EXPENSE_REIMBURSEMENT` |
| `collections` | `related_charge_id`（可选 FK，新增）、`expected_amount_cents`（可选，新增）、`parent_collection_id`（可选自关联 FK，新增） |

### 2.3 既有表，完全不变（9 张）

`users`、`roles`、`role_permissions`、`drivers`、`driver_locations`、`legs`、`settlements`、`settlement_items`、`company_settings`、`audit_logs`

---

## 3. 每张 Table 的职责

### `charge_types`（新增）
参考资料表，定义系统里所有合法的收费项目分类，以及每个分类的 Revenue Rule（`is_company_revenue`/`participates_in_revenue_sharing`）。新增分类是纯资料操作，不需要改代码。

**第一版 Seed 资料**（只 Seed 这 4 个，Toll/Parking/Fuel 属于 Trip Expense 不是 Booking Charge，Discount 暂不开发只保留架构位置）：

| key | label | participates_in_revenue_sharing | is_company_revenue |
|---|---|:-:|:-:|
| `FARE` | 车资 | `true` | — |
| `SURCHARGE` | 加价（深夜/节假日/高需求） | `true` | — |
| `EXTRA_SERVICE` | 额外服务（绕路/等待等） | `true` | — |
| `PERSONAL_TIP` | 客户小费 | `false` | `false`（全归司机） |

不 Seed：`DISCOUNT`（架构预留 `adjusts_charge_id` 可指向，不实现计算逻辑）。以后如果要把 `SURCHARGE`/`EXTRA_SERVICE` 拆细（例如分出 `NIGHT_SURCHARGE`、`WAITING_TIME`），或新增不参与 Revenue Sharing 的服务费类型（例如代买/排队），都只是新增资料列，不需要改代码。

### `booking_charges`（新增）
记录客户应该支付的每一笔费用，独立 Ledger，Append Only。`Booking.total_amount_cents`（沿用既有栏位，改为快取值）永远等于这张表所有 `adjustment_type ≠ REVERSAL` 相关净额的加总（细节见第 6 章）。**新增 `adjustment_type`/`adjusts_charge_id`/`adjustment_reason` 三个栏位，取代原本设计草案里的 `reverses_charge_id`**——用统一的 Adjustment 概念同时涵盖「补收」跟「冲销」两种更正情境。

### `trip_expenses`（新增）
记录行程中公司或司机的实际支出（过路费/停车费/油钱），独立 Ledger，Append Only，完全不影响客户应付金额，也不参与 Revenue Sharing。更正机制维持原设计（`reverses_expense_id`，Void 后重建），这次没有变动。

### `revenue_sharing_snapshots`（新增）
Booking 进入 `FINALIZED` 财务状态时产生的唯一一笔快照，锁定当下算出来的 Company Revenue / Driver Pool，供报表/审计使用，永不重算、永不覆写。每张 Booking 最多一笔。**2026-07 修正（driver-earnings-after-leg-completion，见 [wallet-migration.md](../modules/wallet-migration.md)）**：Financial V2 的 Booking，第一条 Leg 完成时会自动触发（不再只有手动 Finalize API 这一个触发点），`triggered_by` 用 `LEG_COMPLETED` 区分来源；Financial V1 的 Booking 仍然完全不受影响（继续用 `LEG_EARNING`，不建立 Snapshot）。

### `bookings`（既有，扩充）
新增 `financial_status`（`OPEN`/`ACCRUING`/`FINALIZED`/`VOIDED`），跟既有的营运 `status` 并行、同样是派生值。`total_amount_cents`/`platform_amount_cents`/`driver_pool_amount_cents` 三个既有栏位维持存在，但语意从「可编辑」改为「快取的计算结果」。

### `wallet_transactions`（既有，扩充）
新增 `source` 分类栏位（钱的源头是 Booking Revenue、Trip Expense、人工调整、还是 Settlement 更正）、`trip_expense_id`（报销专用）跟**新增的 `booking_charge_id`**——后者是这次为了满足「Snapshot、Wallet、Settlement、Collection、Expense 都可以从 Booking 完整追踪」而补上的栏位：当一笔 Wallet Transaction 是因为某一笔特定的 `BookingCharge`（尤其是 Adjustment）而直接产生时，用这个栏位精确指回那一笔 Charge；一般 Leg 完成产生的 `LEG_EARNING`（从整个 Driver Pool 聚合分配而来，不对应单一 Charge）则维持只用既有的 `leg_id` 参照，`booking_charge_id` 留空。

### `collections`（既有，扩充）
新增 `related_charge_id`（单向、可选，标注这笔实收对应哪一笔应收费用，不做金额校验）跟 Partial Collection 需要的 `expected_amount_cents`/`parent_collection_id`。

### 既有不变的 9 张表
职责跟现有文件（[rbac.md](../modules/rbac.md)、[commission-wallet-settlement.md](../modules/commission-wallet-settlement.md)、[collection.md](../modules/collection.md)、[company-settings.md](../modules/company-settings.md)）描述的完全一致，这次不动。

---

## 4. Table 之间的关系（含 Cardinality）

| 关系 | Cardinality | 说明 |
|---|---|---|
| `Booking → Leg` | 1:N | 既有，不变 |
| `Booking → BookingCharge` | 1:N | 新增 |
| `Leg → BookingCharge` | 0/1:N | 新增，可选（Charge 可以不挂在任何特定 Leg 上） |
| `ChargeType → BookingCharge` | 1:N | 新增 |
| `BookingCharge → BookingCharge`（`adjustsChargeId`） | 0/N:1 | 新增，自关联；`ADDITION` 可以多笔指向同一个原始 Charge，`REVERSAL` 对同一个原始 Charge 最多一笔（Partial Unique Index，见第 5 章） |
| `Booking → TripExpense` | 1:N | 新增 |
| `Leg → TripExpense` | 0/1:N | 新增，可选 |
| `TripExpense → TripExpense`（`reversesExpenseId`） | 0/1:1 | 新增，自关联，冲销专用 |
| `TripExpense → WalletTransaction` | 0/1:1 | 新增（只有需要报销的 Expense 才有对应交易） |
| `Booking → RevenueSharingSnapshot` | 0/1:1 | 新增，唯一约束 `bookingId` |
| `Driver → WalletTransaction` | 1:N | 既有，不变 |
| `BookingCharge → WalletTransaction`（`bookingChargeId`） | 0/1:N | 新增，可选，追溯用 |
| `Driver → Collection` | 1:N | 既有，不变 |
| `BookingCharge → Collection`（`relatedChargeId`） | 0/1:N | 新增，单向（一笔 Charge 可以对应多笔部分收款） |
| `Collection → Collection`（`parentCollectionId`） | 0/1:N | 新增，自关联，Partial Collection 分组 |
| `Settlement → SettlementItem → WalletTransaction` | 1:N / 1:1 | 既有，不变 |

---

## 5. 关联与删除策略总表

**行级删除策略的通用原则**：所有 Financial Ledger 表（`booking_charges`、`trip_expenses`、`wallet_transactions`、`collections`、`settlements`、`settlement_items`、`revenue_sharing_snapshots`）**没有 DELETE API，连 Soft Delete 都不用**——冲销优于删除（Financial Principle #7），要撤销一律新增反向纪录（`booking_charges` 用 `adjustment_type=REVERSAL`，`trip_expenses` 用 `reverses_expense_id`），不隐藏、不物理删除任何一笔历史。参考资料表（`charge_types`）用 `active` 布林值做「停用」，同样没有物理删除 API。

| Table | 主键 | 外键 → 目标表 | ON DELETE 策略 | 理由 |
|---|---|---|---|---|
| `charge_types` | `id` | — | — | 参考资料表，本身不引用别人 |
| `booking_charges` | `id` | `booking_id` → `bookings.id` | **Restrict** | Booking 本来就不支援物理删除，理论上限保护 |
| | | `leg_id` → `legs.id`（可选） | **SetNull** | Leg 允许在 `PENDING` 时被删除；Charge 不该因此消失，退回「归属整张 Booking」 |
| | | `charge_type_id` → `charge_types.id` | **Restrict** | 绝不允许一笔 Charge 的分类凭空消失 |
| | | `adjusts_charge_id` → `booking_charges.id`（自关联，可选） | **Restrict** | 被调整的原始记录不能被删除（反正 Ledger 表本来就不给删） |
| | | `created_by` → `users.id` | **Restrict** | 保留是谁建立的，Audit 需要 |
| `trip_expenses` | `id` | `booking_id` → `bookings.id` | **Restrict** | 同上 |
| | | `leg_id` → `legs.id`（可选） | **SetNull** | 同 `booking_charges.leg_id` |
| | | `reverses_expense_id` → `trip_expenses.id`（自关联，可选） | **Restrict** | 同上 |
| | | `wallet_transaction_id` → `wallet_transactions.id`（可选，唯一） | **Restrict** | 报销交易一旦产生不可能消失 |
| | | `created_by`/`verified_by`/`rejected_by`/`voided_by` → `users.id` | **Restrict**（全部） | Audit 需要 |
| `revenue_sharing_snapshots` | `id` | `booking_id` → `bookings.id`（**唯一**） | **Restrict** | 每张 Booking 最多一笔，Booking 不会被删 |
| `bookings`（扩充栏位） | `id`（既有） | — | — | 本次只新增 `financial_status` 栏位，不新增关联 |
| `wallet_transactions`（扩充栏位） | `id`（既有） | 新增 `trip_expense_id` → `trip_expenses.id`（可选，唯一） | **Restrict** | 一笔报销交易只能对应一笔 Expense，且不可能被删 |
| | | 新增 `booking_charge_id` → `booking_charges.id`（可选） | **SetNull** | 纯追溯参照，Charge 本身不会被删，但保留弹性不让这层参照挡住 Wallet 记录存在 |
| `collections`（扩充栏位） | `id`（既有） | 新增 `related_charge_id` → `booking_charges.id`（可选） | **SetNull** | 纯核对标注，不该因为极端边界情况挡住 Collection 记录存在 |
| | | 新增 `parent_collection_id` → `collections.id`（自关联，可选） | **Restrict** | 分组的父记录不该被删（反正 Collection 本来就不给删） |

**索引规划**（新增/扩充栏位相关）：

| Table | 索引 | 用途 |
|---|---|---|
| `charge_types` | `UNIQUE(key)`、`INDEX(active)` | 依 key 查找、过滤停用分类 |
| `booking_charges` | `INDEX(booking_id)`、`INDEX(leg_id)`、`INDEX(charge_type_id)`、`INDEX(adjusts_charge_id)`、`UNIQUE(adjusts_charge_id) WHERE adjustment_type = 'REVERSAL'`（Partial Unique，允许多笔 `ADDITION` 指向同一原始 Charge，但 `REVERSAL` 只能一笔）、`INDEX(charge_type_id, created_at)` | 依 Booking/Leg 查列表、防止重复冲销同一笔、未来营收报表依分类+时间聚合 |
| `trip_expenses` | `INDEX(booking_id)`、`INDEX(leg_id)`、`INDEX(status)`、`INDEX(paid_by, reimbursement_required)`、`UNIQUE(reverses_expense_id)` | 列表查询、Admin 审核队列（依状态过滤）、报销队列 |
| `revenue_sharing_snapshots` | `UNIQUE(booking_id)` | 每张 Booking 最多一笔的约束本身就是索引 |
| `bookings` | `INDEX(financial_status)` | 未来查「所有还没 FINALIZED 的 Booking」 |
| `wallet_transactions` | `INDEX(source)`、`UNIQUE(trip_expense_id)`（允许多个 NULL）、`INDEX(booking_charge_id)` | 依来源过滤/报表、防止同一笔 Expense 被报销两次、追溯查询 |
| `collections` | `INDEX(related_charge_id)`、`INDEX(parent_collection_id)` | 对帐查询、Partial Collection 分组查询 |

---

## 6. Append Only 在 Schema 层怎么落实

| Table | 落实方式 |
|---|---|
| `booking_charges` | 没有 UPDATE/DELETE 对应的 Backend API。原始 Charge `adjustment_type = NONE`；补收新增一笔 `adjustment_type = ADDITION`（`adjusts_charge_id` 指回原始，`amount_cents` 是要补收的正数）；冲销新增一笔 `adjustment_type = REVERSAL`（`adjusts_charge_id` 指回原始，`amount_cents` 是相反数）。`Booking.total_amount_cents` = `SUM(amount_cents)`，`REVERSAL` 记录本身用负数金额自然抵销，不需要额外的「排除已冲销记录」逻辑。 |
| `trip_expenses` | 用 `reverses_expense_id`；状态转换（`VERIFIED`/`REJECTED`/`REIMBURSED`/`VOIDED`）本身是允许的（那是流程推进，不是改金额），但金额栏位 `amount_cents` 一旦建立永远不动 |
| `wallet_transactions` | 沿用既有机制不变（`SETTLED` 后不可逆） |
| `collections` | 沿用既有机制不变，Partial Collection 的每一笔分期收款都是新记录，不是回头改 `amount_cents` |
| `revenue_sharing_snapshots` | 整张表没有任何 UPDATE 路径，`booking_id` 唯一约束保证每张 Booking 只会新增这一笔，之后连新增都不行 |
| `settlements`/`settlement_items` | 既有机制不变 |

**`FINALIZED` 之后的强制规则**（呼应 financial-model-v2.md 已确认规则 28）：
1. 不允许修改或删除原始 Charge（Append Only 通用规则）。
2. Booking `financial_status = FINALIZED` 之后，新增的 `booking_charges` 只能是 `adjustment_type = ADDITION` 或 `REVERSAL`，不能再是 `NONE`（这条在 Backend service 层的写入事务里检查——判断当下的 `financial_status`，不是 DB 层 CHECK constraint，因为 DB CHECK 看不到别的表的状态；DB 层只保证 `adjustment_type` 跟 `adjusts_charge_id` 的搭配合法，见下）。
3. DB 层 CHECK constraint：`(adjustment_type = 'NONE' AND adjusts_charge_id IS NULL) OR (adjustment_type IN ('ADDITION', 'REVERSAL') AND adjusts_charge_id IS NOT NULL)`——保证「有指向原始 Charge」跟「是不是 Adjustment」这两件事永远一致，不会出现说自己是 Adjustment 却没有指向任何原始记录的脏资料。
4. 不会重新计算或覆写已经产生的 `FINALIZED` Snapshot（`revenue_sharing_snapshots` 没有 UPDATE 路径，天然保证）。

---

## 7. 为什么这次不会有 Breaking Migration

- **没有删除或改名任何既有栏位**：`bookings.total_amount_cents`/`platform_amount_cents`/`driver_pool_amount_cents` 全部保留，只是语意从「可编辑」变成「快取的计算结果」——既有的查询、报表、前端 TS 型别完全不用改，Backend service 层改成写入来源不同而已。
- **`wallet_transactions.transaction_type` 新增一个 enum 值**（`EXPENSE_REIMBURSEMENT`）：Postgres 的 `ALTER TYPE ... ADD VALUE` 是 Additive 操作，不影响既有资料或既有的 enum 值。
- **所有新栏位都是可选（nullable）或有明确默认值**：`financial_status` 会用既有的 `status`/`Leg`/`WalletTransaction`/`Collection` 资料反推 backfill（细节见第 9 章），不需要使用者手动补值。
- **所有新表都是全新的、不影响既有查询路径**：既有 API 完全不用改就能继续动作，新功能透过新的 API 端点暴露（留到 API 设计阶段）。

---

## 8. 延伸性预留（3–5 年可扩充，本次不实作，先说明设计意图）

以下不是这次要做的功能，而是「万一以后要做，这次的表结构会不会逼你重新设计」的检查：

- **多公司 / 多分公司（Future Scenario）**：目前 `company_settings` 维持单例表不变。如果未来真的要支援多公司，可以新增一张 `companies` 表，并在 `company_settings`、`bookings`（或更上层）新增一个 nullable `company_id`——这是 Additive 操作，不需要重建现有任何一张表。
- **多币种（Future Scenario）**：这次沿用系统既有的「单一币别整数 cents」假设，不在这次的新表里加 `currency_code`。如果要加，是在每张金额表新增一个有默认值的 nullable 栏位，同样是 Additive，不影响现有资料。
- **`ChargeType`/`TripExpense.expense_type` 未来可能的扩充**：`charge_types` 已经是资料表，新增分类是纯资料操作；`trip_expenses.expense_type` 这次维持 Prisma enum（范围小、变动机率低），如果之后证明需要频繁扩充，改成跟 `charge_types` 一样的资料表模式也是 Additive 操作（新建表 + 一次性把既有 enum 值转成资料列）。

---

## 9. Financial Status Backfill 规则（`bookings.financial_status`）

**判断优先级（由上到下，符合就停止，不再往下判断）**：

```
1. IF booking.status = 'CANCELLED'
     THEN financial_status = 'VOIDED'

2. ELSE IF EXISTS (Leg WHERE bookingId = booking.id AND status = 'COMPLETED')
        OR EXISTS (WalletTransaction WHERE bookingId = booking.id)
        OR EXISTS (Collection WHERE bookingId = booking.id AND settlementId IS NOT NULL)
     THEN financial_status = 'FINALIZED'

3. ELSE
     financial_status = 'OPEN'
```

**为什么 `CANCELLED` 判断必须放在第一优先**：既有系统允许「Booking 整体取消时，已经 `COMPLETED` 的 Leg 不受影响」（见 [driver-account.md](../modules/driver-account.md)）——也就是说一张 `status = CANCELLED` 的 Booking，完全可能同时满足「有 `COMPLETED` 的 Leg」或「有 WalletTransaction」这两个条件。如果不是把 `CANCELLED` 检查放在最前面、命中就停止，这种 Booking 会被误判成 `FINALIZED` 而不是 `VOIDED`，营运状态跟财务状态就对不上。

**为什么用 `ACCRUING` 没有出现在 Backfill 规则里**：`ACCRUING`（有部分 Leg 完成、但整体还没结束）在既有资料里的对应情境是「`status = IN_PROGRESS` 且已经有 Leg 完成过」，这次 Backfill 直接把这种情况一并归进 `FINALIZED` 判断式的第二条件（有 `WalletTransaction` 就命中）——**这里刻意简化**：Backfill 只处理「历史资料」，既有系统里 `IN_PROGRESS` 的 Booking 如果已经有 Wallet 记录，代表财务上已经不是单纯的 `OPEN`；严谨来说应该分成 `ACCRUING`（还有 Leg 未完成）跟 `FINALIZED`（全部 Leg 都完成），但 Backfill 这个当下的目的是「不要让旧资料處於错误状态」，之后系统正常运作时，`financial_status` 会由 Leg 完成/Booking 完成的事件即时正确地推导覆盖过去（`ACCRUING`/`FINALIZED` 的判断都是即时算的，不是只在 Migration 时算一次），所以 Backfill 阶段稍微保守（把「有资金活动但可能还没完全结束」的旧资料先摆到 `FINALIZED`）不会造成长期错误，下一次任何 Leg 状态变动都会重新推导成正确值。

**幂等性（可以重复安全执行）**：整条规则是纯函数——只读 `bookings.status`/`legs.status`/`wallet_transactions` 是否存在/`collections.settlement_id` 是否存在，输出完全由这些既有资料决定，不依赖「这是不是第一次跑」的任何状态。用 `UPDATE bookings SET financial_status = <上面的 CASE 表达式>` 对全表跑一次，跑幾次结果都一样，安全可以重复执行，不会因为重复执行而产生不同结果或报错。

---

## 10. Multi-Leg Driver Pool：一致性规则与并发控制

一张 Booking 可以有多个 Leg（去程 Driver A、回程 Driver B……），所有 Leg **共用同一个 Booking 层级的 Driver Pool 上限**（`driverPoolCents`，即时用 Revenue Sharing 计算得出，见 financial-model-v2.md 第 7 章），但每个 Leg 的收入实现（`LEG_EARNING`）彼此独立（financial-model-v2.md 第 7 章 Multi-Leg Financial Rule）。

### 规则

1. **所有有效 Leg Allocation 总和不能超过 Driver Pool**——沿用既有的 `assertAllocationFits` 逻辑（[legs.service.ts](../../apps/backend/src/modules/bookings/legs.service.ts)），比较对象从「静态的 `driverPoolAmountCents` 栏位」改成「即时算出来的 `driverPoolCents`」，检查逻辑本身不变：`SUM(未取消 Leg 的 earningAllocationCents) ≤ driverPoolCents`。
2. **`COMPLETED` 的 Leg，`earningAllocationCents` 不可修改**——既有规则不变。
3. **已经产生 `WalletTransaction` 的 Leg，`earningAllocationCents` 不可修改**——既有规则不变（比状态检查更保险的第二层防护）。
4. **新增 Adjustment Charge 后，不自动重算已经产生的 `RevenueSharingSnapshot`**——`revenue_sharing_snapshots` 没有 UPDATE 路径，天然保证。
5. **如果新增的 Adjustment Charge 需要让某个 Driver 多收到钱，必须新增一笔新的 `WalletTransaction`**（不能回头改原本那笔 `LEG_EARNING`），这笔新的 Transaction 用 `source = BOOKING_REVENUE`、`booking_charge_id` 指回触发它的那笔 Adjustment Charge（这就是第 3 章提到新增 `booking_charge_id` 栏位的实际用途）。
6. **并发控制**：两个请求同时对同一张 Booking 底下的不同 Leg 设定/调整 `earningAllocationCents`，必须防止两者都读到「调整前」的总额、都通过检查、结果加总超过 Driver Pool。做法：在检查 + 写入的同一个 DB Transaction 里，对这张 `bookings` row 下 `SELECT ... FOR UPDATE` 悲观锁（锁 Booking，不是锁个别 Leg——因为限制本来就是 Booking 层级的共用上限），锁定期间重新查一次当下所有未取消 Leg 的 allocation 总和，通过才放行写入、否则拒绝。这跟既有系统处理 Settlement Reference 并发（`pg_advisory_xact_lock`）、Settlement Void 并发（条件式 `UPDATE ... WHERE status = 'COMPLETED'`）是同一种「不相信先读到的数字，交给 DB 事务锁保证」的一贯做法。

---

## 11. 收尾确认清单

| 项目 | 状态 |
|---|---|
| 所有金额字段使用 integer cents | ✅ 全部新栏位（`amount_cents`、`expected_amount_cents`、`company_revenue_cents`、`driver_pool_cents`）都是 `Int`，没有任何 Decimal/Float |
| 所有财务表默认禁止硬删除 | ✅ 第 5 章开头已明确：`booking_charges`/`trip_expenses`/`wallet_transactions`/`collections`/`settlements`/`settlement_items`/`revenue_sharing_snapshots` 都没有 DELETE API，连 Soft Delete 都不用 |
| Foreign Key 删除策略写清楚 | ✅ 第 5 章逐一列出每个 FK 的 ON DELETE 策略跟理由 |
| 重要查询字段建立 index | ✅ 第 5 章「索引规划」逐表列出 |
| Snapshot、Wallet、Settlement、Collection、Expense 都可以从 Booking 完整追踪 | ✅ 新增 `wallet_transactions.booking_charge_id` 补上原本缺的一段链路，完整路径见第 1.1/1.5 节的 ER 图跟 financial-model-v2.md 第 12 章 Money Reference Trace |
| Migration 不删除现有数据 | ✅ 第 7 章说明，全部是新增栏位/新增表，没有 DROP 任何既有栏位或资料 |
| Migration 前后现有测试都必须通过 | 会在实作阶段（Prisma Schema + Migration + Integration Test）实际验证，结果会在完成报告里列出 |

---

## 12. 本次已定案（原第 9 章的 4 个未确认细节，现已全部解决）

1. **`charge_types` Seed** — 见第 3 章，只 Seed `FARE`/`SURCHARGE`/`EXTRA_SERVICE`/`PERSONAL_TIP`。
2. **`financial_status` Backfill** — 见第 9 章，含优先级判断跟幂等性说明。
3. **Adjustment Charge 标记** — 见第 6 章，`adjustment_type`（`NONE`/`ADDITION`/`REVERSAL`）+ `adjusts_charge_id` + `adjustment_reason`，取代原本「用 `created_at` 推导」的设计。
4. **Multi-Leg Driver Pool** — 见第 10 章，一致性规则 + 并发控制机制。

仍然维持开放、留到之后阶段的：
- Permission Key（`bookingCharge:*`/`tripExpense:*` 之类）——留到 API 设计阶段。
- `trip_expenses.expense_type` 是否要跟 `charge_types` 一样改成资料表——这次维持 enum，见第 8 章。

---

以上是完整的 ER 层级设计（第二版）。接下来直接进入 Prisma Schema + Migration + Seed/Backfill + Database Integration Tests 实作，暂不涉及 API/Frontend/UI。
