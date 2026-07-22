# Financial Model v2 — 设计文件（尚未实作）

> **状态：设计讨论定案，尚未开始开发。** 本文件是 Booking / Commission / Wallet / Settlement / Collection 财务架构的重新设计，取代原本「Booking 只有一个总价」的模型。在这份文件被明确批准之前，不会有任何代码改动。

## 目录

1. [Financial Architecture（整体架构）](#1-financial-architecture整体架构)
2. [Financial Principles（核心原则）](#2-financial-principles核心原则)
3. [Booking](#3-booking)
4. [Booking Charge](#4-booking-charge)
5. [Trip Expense](#5-trip-expense)
6. [Collection](#6-collection)
7. [Revenue Sharing](#7-revenue-sharing)
8. [Wallet](#8-wallet)
9. [Settlement](#9-settlement)
10. [Audit Log](#10-audit-log)
11. [完整资金流](#11-完整资金流)
12. [Money Reference Trace（资金追溯）](#12-money-reference-trace资金追溯)
13. [已确认的业务规则清单](#13-已确认的业务规则清单)
14. [尚未决定的业务规则](#14-尚未决定的业务规则)
15. [Future Business Scenarios（未来业务场景）](#15-future-business-scenarios未来业务场景)

---

## 1. Financial Architecture（整体架构）

系统里有 **四本独立的 Ledger**，彼此边界清楚，只有一条明确定义的单向关联线，不合并、不共用表：

```
┌─────────────────┐
│  Booking Charge  │  客户应该支付什么（收费模型）
└────────┬─────────┘
         │ Collection.relatedChargeId（单向、可选，纯核对标注）
         ▼
┌─────────────────┐
│    Collection     │  实际收到/代收/代付/退款的钱（资金流）
└──────────────────┘

┌─────────────────┐
│   Trip Expense    │  行程中公司/司机的支出（Toll/Parking/Fuel…）——完全独立，
└──────────────────┘  不进 Customer Total，不参与 Revenue Sharing

┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│ Revenue Sharing   │──────▶│      Wallet        │──────▶│    Settlement      │
│ （计算层，非表）    │        │ 司机应收（Ledger）  │        │  日结批次处理        │
└─────────────────┘        └─────────────────┘        └─────────────────┘
```

### 各 Module 职责边界总表

| Module | 负责什么 | 不负责什么 |
|---|---|---|
| **Booking Charge** | 记录客户应该支付的每一项费用，是「收费模型」 | 不记录钱有没有实际收到；不处理司机垫钱/代买/退款 |
| **Trip Expense** | 记录行程中公司或司机实际花掉的钱（过路费、停车费、油钱） | 不影响客户要付多少钱；不参与 Commission/Revenue Sharing；不是收费项目 |
| **Collection** | 记录司机实际收到/代收/代付/退款的资金流，是「实际资金流」 | 不决定客户应该付多少钱（那是 Booking Charge 的职责）；不做 Revenue Sharing 计算 |
| **Revenue Sharing** | 把 Booking Charge 里「参与分成」的项目，依 Commission 拆成 Platform / Driver 两份；把其余项目依配置全额归到某一边 | 不是一张表，是计算逻辑；不处理 Trip Expense（完全不碰） |
| **Wallet** | 记录司机「应该收到多少钱」的 Ledger（Leg 收入、手动调整、结算调整、Expense 报销） | 不决定钱从哪来（那是 Revenue Sharing/Expense 算出来的结果，Wallet 只负责记账） |
| **Settlement** | 把一段区间内 Wallet 里 PENDING 的交易批次处理成不可变的结算记录 | 不产生新的收入/支出来源；不修改任何历史 Wallet Transaction 金额 |

**共同原则**：以上每一本 Ledger 都是 **Append Only**——建立后金额栏位不可修改，要更正只能新增一笔新纪录（正常新增或反向冲销），没有例外。完整原则清单见第 2 节。

---

## 2. Financial Principles（核心原则）

整个 Financial Module（不分哪一本 Ledger）共同遵守以下原则。这些大多不是新发明——Module 3（Wallet/Settlement）、Module 4（Collection）已经在用，这里是把它们正式确立成贯穿全部财务设计的共同规范：

1. **Append Only Ledger（不可变账本）**——Booking Charge、Trip Expense、Collection、Wallet Transaction、Settlement，一旦建立，金额栏位不可修改、不可物理删除。更正一律新增一笔新纪录（新增或反向冲销），历史永远保留原样。
2. **Snapshot（快照原则）**——任何会随时间变动的设定值，一旦被某笔交易用掉，就把当下的值复制到那笔交易自己身上，不能让历史交易的意义因为之后设定值改变而跟着变。既有例子：Booking 建立时复制 Company Settings 的默认 Commission；这次新增例子：Revenue Sharing Snapshot（见第 7 节）。
3. **Audit Everything**——所有会影响金额或状态的操作都要写 Audit Log，固定包含操作人（`actorUserId`/`actorRole`）、时间、变更前、变更后。
4. **Integer Cents Only（禁止浮点数）**——所有金额栏位一律整数 cents，没有 Decimal/Float 金额栏位，Backend 全程整数运算。
5. **Single Rounding Point（唯一四舍五入入口）**——全系统只有 `roundToNearestCent` 一个地方做四舍五入，避免各处逻辑各算各的、加总对不上。
6. **No Client-Trusted Amounts（前端不能决定最终金额）**——所有牵涉金额计算的栏位，一律由 Backend 重新计算/验证，不接受前端直接传「最终结果」让 Backend 原样存档。
7. **Reversal over Deletion（冲销优于删除）**——没有任何 API 能物理删除一笔已经存在的财务记录，要撤销一律新增一笔相反的纪录，并保留指回原纪录的关联。
8. **Concurrency Safety（并发安全）**——涉及唯一序号产生（例如 Settlement Reference）或状态转换（例如 Void）的操作，一律用条件式 `UPDATE ... WHERE status = X` 或 advisory lock，不用「先读再写」的方式，避免竞态漏洞。

---

## 3. Booking

### 负责什么
- 作为整趟服务的容器：Girl 主体、Leg（车程）列表、状态（PENDING/IN_PROGRESS/COMPLETED/CANCELLED，依 Leg 自动推导，机制不变）。
- 持有 Commission 默认值快照（`platformCommissionType`/`platformCommissionValue`，建立时从 Company Settings 复制，可单独覆盖），给参与 Revenue Sharing 的 Charge 使用。

### 不负责什么
- **不再直接持有可编辑的 `totalAmountCents`**——这个数字变成「派生值」：`SUM(未冲销的 BookingCharge.amountCents)`，只能读，不能被 API 直接写入。
- 不负责算钱怎么分（那是 Revenue Sharing 的职责）、不负责记录实际收了多少钱（Collection 的职责）、不负责记录行程支出（Trip Expense 的职责）。

### 变化说明
- 原本「Booking 有 COMPLETED 的 Leg 或已有 Wallet Transaction 就锁死总价/抽成」的特例规则**整个拿掉**——因为现在总价不是一个可以被「锁住」的独立栏位，它永远是 Charge 的加总；Charge 本身遵守 Append Only，不需要额外靠锁 Booking 来保护历史。
- Leg 的收入分配（`earningAllocationCents`）机制不变，只是「可分配的 Driver Pool 总额」的来源改变（见第 7 节）。

### Booking Financial Status Flow

Booking 现有的 `status`（PENDING/IN_PROGRESS/COMPLETED/CANCELLED）是「营运状态」，依 Leg 进度推导，这次不变。这次新增一个**独立的财务状态维度** `financialStatus`，专门反映这张 Booking 的收入是否已经定案，跟营运状态并行存在，不是取代关系：

```
OPEN ──▶ ACCRUING ──▶ FINALIZED
  │           │
  └───────────┴──────▶ VOIDED
```

| 状态 | 触发条件 | 意义 |
|---|---|---|
| `OPEN` | 预设状态，还没有任何 Leg 完成过 | Charge 可以自由新增/冲销，Revenue Sharing 都是即时计算，还没有任何金额「实现」到 Wallet |
| `ACCRUING` | 至少一笔 Leg 已经 `COMPLETED`，产生过 `LEG_EARNING` | 已经有部分金额透过 Revenue Sharing 实现到 Wallet，但营运面 `status` 还是 `IN_PROGRESS` |
| `FINALIZED` | 营运面 `status` 变成 `COMPLETED`（所有 Leg 都结束） | 触发一次 Revenue Sharing 的最终 Snapshot（见第 7 节），标志这张 Booking 的财务结果定案 |
| `VOIDED` | 营运面 `status` 变成 `CANCELLED` | Booking 整体取消，已经产生的 Wallet 记录（如果有）不会被修改，只能用冲销方式处理 |

`financialStatus` 是**派生值**，不是可以手动设定的栏位，跟营运 `status` 一样由系统根据 Leg/Wallet 事件推导。

---

## 4. Booking Charge

### 负责什么
记录「客户应该支付」的每一笔费用组成，独立 Ledger，Append Only。

### 不负责什么
- 不记录钱有没有实际收到（Collection 的职责）。
- 不记录行程支出（Trip Expense 的职责）。
- 不自己判断怎么分钱——只是标注「这笔要不要参与分成」，实际计算在 Revenue Sharing 层。

### 数据模型

**`BookingCharge`**

| 栏位 | 说明 |
|---|---|
| `id` | PK |
| `bookingId` | 所属 Booking |
| `legId`（可选） | 归属到特定 Leg，不填代表整张 Booking 共用 |
| `chargeTypeId` | FK → `ChargeType`（见下），**不是写死的 enum** |
| `amountCents` | 整数 cents |
| `commissionType` / `commissionValue`（可选，仅参与 Revenue Sharing 的 Charge 用） | 建立时从 Booking 层级的默认值 snapshot，允许单独覆盖 |
| `description` | 备注 |
| `reversesChargeId`（可选，自我关联） | 如果是冲销另一笔的反向纪录，指回原本那笔 |
| `createdBy` / `createdAt` | Audit 用 |

**没有 UPDATE/DELETE API，也没有 `status` 栏位**——写错了不能改，只能新增一笔 `amountCents` 相反、`reversesChargeId` 指回原纪录的冲销 Charge。

**`ChargeType`（参考资料表，数据驱动，不是代码 enum）**

| 栏位 | 说明 |
|---|---|
| `key` | 唯一字符串，例如 `FARE`、`NIGHT_SURCHARGE` |
| `label` | 显示名称 |
| `isCompanyRevenue` | Boolean |
| `participatesInRevenueSharing` | Boolean |
| `active` | Boolean，停用不影响历史 Charge |

**两个 flag 的运算优先级**：
1. `participatesInRevenueSharing = true` → 这笔金额照 Commission % 拆成 Platform / Driver 两份，`isCompanyRevenue` 不生效（已经是拆分的，不是二选一）
2. `participatesInRevenueSharing = false` → 整笔金额归一边：`isCompanyRevenue = true` 全部算 Company Revenue，`false` 全部算 Driver Passthrough

新增 Charge Type 只需要在这张表插入一笔资料，**不需要修改任何业务逻辑代码**。

### 建议的初始 Seed 资料

| key | participatesInRevenueSharing | isCompanyRevenue | 依据 |
|---|:-:|:-:|---|
| `FARE` | ✅ | — | 基本车资，唯一确定参与 Revenue Sharing 的项目 |
| `NIGHT_SURCHARGE` | ✅ | — | 属于运输服务一部分，默认参与 |
| `PEAK_HOUR_SURCHARGE` | ✅ | — | 同上 |
| `HOLIDAY_SURCHARGE` | ✅ | — | 同上 |
| `EXTRA_STOP` | ✅ | — | Extra Service，默认参与 |
| `WAITING_TIME` | ✅ | — | Extra Service，默认参与 |
| `BUY_ITEM` | ❌（建议） | ❌ Driver Passthrough（建议） | 由 Type 自己决定；这是业务上合理的默认值，不是确认过的决定，可随时调整数据不用改代码 |
| `QUEUE` | ❌（建议） | ❌ Driver Passthrough（建议） | 同上 |
| `DOCUMENT_DELIVERY` | ❌（建议） | ❌ Driver Passthrough（建议） | 同上 |
| `PERSONAL_TIP` | ❌ | ❌ Driver Passthrough | 已确认，Tip 惯例上全归司机 |
| `DISCOUNT` | 不 Seed | 不 Seed | 架构预留（`chargeTypeId` 允许未来指向这个 key），**不实现计算逻辑** |

`Booking.totalAmountCents`（客户应付总额，派生值）= `SUM(未冲销的 BookingCharge.amountCents)`，不含 Trip Expense。

---

## 5. Trip Expense

### 负责什么
记录行程中「公司或司机为这趟服务花了多少钱」——过路费、停车费、油钱等，独立 Ledger，Append Only。

### 不负责什么
- **不增加 Customer Total**——不计入 Booking Total，客户完全看不到、也不会因为这个多付钱。
- **不参与 Commission 或 Revenue Sharing**——跟 Booking Charge 的计算完全无关。
- 不处理 Manager 垫付报销（见第 14 节已知缺口）。

### 数据模型

**`TripExpense`**

| 栏位 | 说明 |
|---|---|
| `id` | PK |
| `bookingId` | |
| `legId`（可选） | |
| `expenseType` | `TOLL` / `PARKING` / `FUEL` / `OTHER`（第一版固定 enum） |
| `amountCents` | |
| `paidBy` | `COMPANY` / `DRIVER`（第一版**不支持** `MANAGER`） |
| `reimbursementRequired` | Boolean，只在 `paidBy=DRIVER` 时有意义 |
| `proofImage`（可选） | 复用 Collection 已经做好的安全上传机制（magic number 校验、大小上限读 Company Settings） |
| `description` | |
| `createdBy` / `createdAt` | |
| `status` | 见下方状态机 |

### Trip Expense Status（状态机）

```
PENDING ──▶ VERIFIED ──▶ REIMBURSED   （只有 paidBy=DRIVER 且 reimbursementRequired=true 才会走到这里）
   │            │
   │            └──▶ VOIDED           （发现记录错误，作废后重建）
   │
   └──▶ REJECTED                      （确认这笔支出不合法/不该记录，终态）
```

| 状态 | 说明 |
|---|---|
| `PENDING` | 刚建立，等待 Admin/Manager 确认 |
| `VERIFIED` | 确认收据/金额正确。`paidBy=COMPANY` 到这里就是终态（纯记账完成）；`paidBy=DRIVER` 且需要报销的会继续往下走 |
| `REJECTED` | Admin/Manager 认定这笔支出不合法或不该记录，**终态**，不会产生任何 Wallet Transaction |
| `REIMBURSED` | 报销已经透过 Wallet（`EXPENSE_REIMBURSEMENT`）完成，**终态** |
| `VOIDED` | 已经 `VERIFIED` 但发现记录错误，作废，**终态**——不能直接改，只能新增一笔反向纪录 + 重新建一笔正确的 |

转换说明：`PENDING → VERIFIED` / `PENDING → REJECTED` 是 Admin/Manager 的审核动作；`VERIFIED → REIMBURSED` 只在 `paidBy=DRIVER` 且 `reimbursementRequired=true` 时发生，由系统在报销 Wallet Transaction 建立成功后自动转；`VERIFIED → VOIDED` 是人工发起的冲销。`REJECTED`/`REIMBURSED`/`VOIDED` 都是终态，判断错了一律新增新的 TripExpense 记录，不修改旧的。

### 业务规则
1. `paidBy = COMPANY` → 纯记账，不产生任何 Wallet Transaction，不影响任何人的钱。
2. `paidBy = DRIVER` 且 `reimbursementRequired = true` → 需要走 Driver Reimbursement，产生一笔新的 Wallet Transaction Type：`EXPENSE_REIMBURSEMENT`，之后跟其他 Wallet 交易一样流入 Daily Settlement。
3. `reimbursementRequired = false` → 只记录支出，不进 Driver Wallet。
4. 必须保留收据（`proofImage`）跟 Audit Log。
5. 已 `VERIFIED` 或已牵涉 Settlement 的 Expense 不允许直接修改，只能 Void 后重建（新增一笔反向纪录 + 一笔新的正确纪录）。
6. Manager 垫付（`paidBy=MANAGER`）第一版完全不支持，未来如果需要，是独立的 **Expense Claim Module**（Claim/Approval/Reject/Reimbursement/Payment），不会塞进 Trip Expense 里。

---

## 6. Collection

### 负责什么（沿用 Module 4 既有设计，未来会扩充）
- 记录司机「实际收到或代收」的款项——现金/转账/TNG 等。
- 处理跟 Booking Charge 无关的资金流：代买东西、代付款、退款。
- 可以用 `relatedChargeId`（单向、可选）标注「这笔实际收到的钱对应哪一笔应收费用」，纯粹方便对帐，**不做金额一致性校验**（例如 Charge 是 RM10、Collection 只收到 RM8，这不该被这个栏位强制拦下来）。

### 不负责什么
- 不决定客户应该付多少钱（Booking Charge 的职责）。
- 不做 Revenue Sharing 计算。
- **不知道 Trip Expense 存在**——两者是完全独立的两本帐，即使概念上都可能涉及「司机垫钱」，也不合并、不共用表（Collection 未来还要处理代买/代付/退款这些完全跟 Booking Charge 无关的场景，如果合并会让边界混乱）。

### 关联方向
```
BookingCharge  ◀── Collection.relatedChargeId（单向）
```
`BookingCharge` 表完全不加任何指回 `Collection` 的栏位，service 层继续互不知道对方存在，跟现在 Wallet/Collection 两本帐只在 Settlement 层交会一次的做法一致。

### Partial Collection（分次收款）

现有 Collection 的每一笔记录假设「一次收清」。为了支持分次收款（例如客户先付一部分、之后再补齐尾款），引入三个概念，**全部是衍生计算，不是新的可编辑栏位**：

- **Expected（应收）**：这一组分次收款原本预期要收到的总额。
- **Received（已收）**：目前为止，实际已经记录进来的 Collection 金额总和。
- **Outstanding（未收/尾款）** = `Expected − Received`（衍生值，随时用 `Received` 现算，不存 DB）。

**做法（延续 Append Only 精神，不是回头改一笔记录的金额）**：一组分次收款的「期望总额」在第一笔 Collection 建立时设定；之后每一次实际收到钱，都是**新增一笔独立的 Collection 记录**，共同归属同一组分次收款，而不是回头修改第一笔记录的金额。`Received` = 这一组底下所有 Collection 记录金额加总；`Outstanding` = 组的 `Expected` 减去加总出来的 `Received`。这跟 `Booking.totalAmountCents = SUM(BookingCharge)` 是同一套哲学：金额永远是加总算出来的，不是一个可以被直接改写的数字。

**跟既有单向关联的关系**：如果这组 Partial Collection 对应某一笔 `BookingCharge`，`Expected` 可以直接读那笔 Charge 的 `amountCents`；如果是跟 Booking Charge 无关的场景（代买/代付/退款），`Expected` 就是这组 Collection 自己独立设定的期望值，不需要关联任何 Charge。

---

## 7. Revenue Sharing

这不是一张表，是**计算逻辑**，输入是某张 Booking 底下所有未冲销的 `BookingCharge`，输出是这张 Booking 的 Company Revenue 总额跟 Driver Pool 总额。

### 负责什么
```
companyRevenueCents = 0
driverPoolCents = 0

for each 未冲销的 charge:
  if charge.chargeType.participatesInRevenueSharing:
      split = calculateCommissionSplit(charge.amountCents, charge.commissionType ?? booking.commissionType, ...)
      companyRevenueCents += split.platformAmountCents
      driverPoolCents     += split.driverPoolAmountCents
  else if charge.chargeType.isCompanyRevenue:
      companyRevenueCents += charge.amountCents
  else:
      driverPoolCents     += charge.amountCents
```

- 沿用既有的 `calculateCommissionSplit`（`commission.ts`），套用对象从「整张 Booking 的总价」改成「单笔参与分成的 Charge 金额」，多笔就跑多次再加总。
- 算出来的 `driverPoolCents` 就是 Leg `earningAllocationCents` 可以分配的总额上限（机制跟现在一样，只是来源换了）。

### 不负责什么
- 不碰 Trip Expense（完全无关，见第 5 节）。
- 不产生 Wallet Transaction——那是 Leg 完成时才做的事（见第 8 节）。
- 不做任何金额的实际转移，纯粹是「算出这次应该怎么分」。

### Revenue Sharing Snapshot 机制

上面的计算是**即时（live）算法**——每次呼叫都用当下的 Charge 资料重新算一次。这对「Booking 还没 `FINALIZED`、Charge 还能自由新增/冲销」的阶段是对的，但 Booking 整体财务定案之后，就需要把当下的计算结果「定格」下来，不能让之后任何变动悄悄改写历史（呼应第 2 节的 Snapshot 原则）。

**明确规定：Snapshot 只在 Booking `financialStatus`（见第 3 节）进入 `FINALIZED` 的当下产生，唯一触发点，不在 Leg 完成时产生。** 每个 Leg 完成时产生的 `LEG_EARNING` 走的是即时计算（见下方 Multi-Leg Financial Rule），本身已经是 Append Only、不可变的记录，不需要额外的 Snapshot 保护；Snapshot 是给「整张 Booking 收入定案」这件事一次性做的最终快照，用途是报表/审计层级的「这笔 Booking 最终收入是多少」，不是驱动 Wallet 记账的依据。

**Snapshot 记录的内容**（概念层级，非最终 schema）：触发来源固定是 `BOOKING_FINALIZED`、当下参与计算的完整 Charge 明细、算出来的 `companyRevenueCents` / `driverPoolCents`。

**FINALIZED 之后的规则**：
1. **不允许修改原有 Charge**——这本来就是 Append Only 的通用规则（第 2 节），这里再次明确适用于 `FINALIZED` 之后。
2. **如需补差额，只能新增 Adjustment**——`FINALIZED` 后新增的 Charge，性质上都算「Adjustment」，一样照 `ChargeType` 的规则参与/不参与 Revenue Sharing、产生自己的 Wallet 记账效果，但**不会**触发重新计算或覆写已经产生的 `FINALIZED` Snapshot。
3. **不重新计算历史 Revenue Sharing**——`FINALIZED` Snapshot 一旦产生就是终态，永远不会因为之后任何新增的 Adjustment Charge 而重新计算或更新；「这笔 Booking 当初定案时的收入是多少」这个历史数字永远保持不变。

### Multi-Leg Financial Rule（每个 Leg 是独立的 Financial Unit）

一张 Booking 可以有多个 Leg（例如去程 Driver A、回程 Driver B），**每个 Leg 都是独立的 Financial Unit，不需要等整张 Booking 完成才能一起结算**：

- **独立完成**——Leg 状态机本来就是各自独立推进的（既有机制不变）。
- **独立产生 Revenue Allocation**——Leg 完成的当下，就用「当时」的即时 Revenue Sharing 计算结果（`driverPoolCents`，见上方）去核对这个 Leg 的 `earningAllocationCents`，不需要等其他 Leg、也不需要等 Booking `financialStatus` 变成 `FINALIZED`。
- **独立进入 Driver Wallet**——每个 Leg 完成各自产生自己的 `LEG_EARNING`（`source=BOOKING_REVENUE`，参照自己的 `legId`），流进各自负责这个 Leg 的司机的 Wallet，司机之间互不影响（既有机制不变，这次只是明确重申）。
- **独立 Settlement**——每个司机各自的 `LEG_EARNING` 依各自的 Daily Settlement 周期结算，不会因为同一张 Booking 底下还有其他 Leg 没完成就被卡住。

**这条规则明确保证**：Booking 的 `financialStatus` 从 `OPEN` 走到 `FINALIZED` 是一个**跟在所有 Leg 之后**才会发生的事件（因为要所有 Leg 结束，营运面 `status` 才会变成 `COMPLETED`），但它**只影响 Revenue Sharing Snapshot 什么时候产生**（用于整张 Booking 的收入报表/审计），完全不会、也不能反过来延迟或阻挡任何单一 Leg 的 `LEG_EARNING` 产生、进 Wallet、或被结算——去程 Driver A 可以在回程 Driver B 的 Leg 都还没开始之前，就已经收到钱、甚至已经被结算过。

---

## 8. Wallet

### 负责什么（沿用 Module 3 既有设计，新增一个 Transaction Type）
记录司机「应该收到多少钱」的唯一记账来源，Append Only：

| Transaction Type | 触发时机 |
|---|---|
| `LEG_EARNING` | Leg 完成，金额 = 该 Leg 的 `earningAllocationCents`（来自 Driver Pool，见第 7 节） |
| `MANUAL_ADJUSTMENT` | Admin 手动一般性调整 |
| `SETTLEMENT_ADJUSTMENT` | 针对已结算记录的更正，或 Void Settlement 产生的反向纪录 |
| **`EXPENSE_REIMBURSEMENT`（新增）** | Trip Expense 的 `paidBy=DRIVER` 且 `reimbursementRequired=true` 时产生 |

### 不负责什么
- 不决定钱从哪来（Revenue Sharing / Trip Expense 算出来的结果，Wallet 只负责记账）。
- **不允许修改或删除任何历史 Transaction**——`SETTLED` 的永远不会被改回 `PENDING`，要更正一律新增新纪录。

### Wallet Transaction Source 分类

现有的 Transaction Type 说明「这是哪一种交易」，但没有说明「这笔钱的源头是什么」。为了支持第 12 节的 Money Reference Trace，替每一笔 Wallet Transaction 额外分类一个 **Source**：

| Source | 对应的 Transaction Type | 说明 |
|---|---|---|
| `BOOKING_REVENUE` | `LEG_EARNING` | 来自 Booking Charge 经过 Revenue Sharing 分配给司机的部分 |
| `TRIP_EXPENSE` | `EXPENSE_REIMBURSEMENT` | 来自 Trip Expense 的司机报销 |
| `MANUAL` | `MANUAL_ADJUSTMENT` | 人为手动新增，不是系统自动产生 |
| `SETTLEMENT_CORRECTION` | `SETTLEMENT_ADJUSTMENT` | Settlement Adjustment 或 Void 产生的更正/反向纪录 |

每笔 Wallet Transaction 除了 Source 分类，还带一个指回源头记录的参照（是哪个 Leg、哪笔 Trip Expense、还是哪个 Settlement）——这个参照是第 12 节资金追溯能够运作的关键。Source 本身只是分类标签，实际的追溯逻辑在第 12 节。

---

## 9. Settlement

### 负责什么（沿用 Module 3 既有设计，不需要改动）
- 把指定区间内 Wallet 里所有 `PENDING` 的 Transaction（现在包含 `LEG_EARNING`/`MANUAL_ADJUSTMENT`/`SETTLEMENT_ADJUSTMENT`/`EXPENSE_REIMBURSEMENT` 四种）批次标记成 `SETTLED`，产生不可变的 Settlement 记录。
- Void 只新增反向 Transaction，原始记录跟金额完全不动。

### 不负责什么
- 不产生新的收入/支出来源，只是把 Wallet 已有的 PENDING 记录批次处理。
- 不修改任何历史 Wallet Transaction、Settlement、SettlementItem 的金额栏位。
- 不知道 BookingCharge/TripExpense 的存在，只认得流进来的 WalletTransaction。

---

## 10. Audit Log

### 负责什么
- 所有会影响金额的新增/冲销操作都要写一笔 Audit Log：`BOOKING_CHARGE_CREATED`、`BOOKING_CHARGE_REVERSED`、`EXPENSE_CREATED`、`EXPENSE_VERIFIED`、`EXPENSE_REJECTED`、`EXPENSE_VOIDED`、`EXPENSE_REIMBURSEMENT_CREATED`，以及既有的 `LEG_EARNING_CREATED`、`MANUAL_ADJUSTMENT_CREATED`、`SETTLEMENT_ADJUSTMENT_CREATED`、`SETTLEMENT_COMPLETED`、`SETTLEMENT_VOIDED`。
- 固定包含 `actorUserId`、`actorRole`、`action`、`entityType`、`entityId`、`beforeData`、`afterData`、`createdAt`（跟现有 `writeAuditLog` 机制一致，不需要新设计）。

### 语意说明（Append Only Ledger 下 before/after 怎么填）
- 新增一笔 Charge/Expense：`beforeData = null`（本来就不存在），`afterData = 新纪录的完整内容`。
- 冲销一笔 Charge/Expense：`afterData = 冲销纪录本身`，`metadata` 里记录 `reversesChargeId`/`reversesExpenseId` 指回原纪录，**不去改原纪录的 Audit Log**（原纪录当初的 Audit Log 保持原样，历史不可篡改）。

### 不负责什么
- 不是业务规则的执行者，只负责记录「发生过什么」，不做任何校验或拦截。

---

## 11. 完整资金流

```
Customer
   │
   ▼
┌─────────────────────────────┐
│ Booking Charge（客户应该付什么）  │   Fare / Surcharge / Extra Service / Personal Tip / (Discount 预留)
└───────────────┬───────────────┘
                │ relatedChargeId（单向、可选，仅供核对）
                ▼
┌─────────────────────────────┐
│  Collection（实际收到什么）        │   Cash / Transfer / TNG…（也处理代买/代付/退款，跟 Charge 无关）
└─────────────────────────────┘

┌─────────────────────────────┐
│ Booking Charge（未冲销的部分）    │
└───────────────┬───────────────┘
                │ 依 ChargeType 的 participatesInRevenueSharing / isCompanyRevenue
                ▼
┌─────────────────────────────┐
│  Revenue Sharing（如何分钱）      │   → companyRevenueCents（公司收入）
└───────────────┬───────────────┘   → driverPoolCents（司机分成池，给 Leg 分配用）
                │
                ▼
┌─────────────────────────────┐
│      Wallet（司机应收）           │   LEG_EARNING / MANUAL_ADJUSTMENT /
└───────────────┬───────────────┘   SETTLEMENT_ADJUSTMENT / EXPENSE_REIMBURSEMENT
                │
                ▼
┌─────────────────────────────┐
│     Settlement（日结）           │   批次把 PENDING 交易标记 SETTLED，产生不可变记录
└─────────────────────────────┘


┌─────────────────────────────┐
│  Trip Expense（行程支出）         │   Toll / Parking / Fuel / Other
│  完全独立，不进 Customer Total，   │   paidBy=DRIVER 且需要报销时才会有一条虚线
│  不参与 Revenue Sharing           │   流进 Wallet（EXPENSE_REIMBURSEMENT），
└─────────────────────────────┘   其余情况完全不接触上面这条主线
```

---

## 12. Money Reference Trace（资金追溯）

第 11 节画的是「钱怎么流动」，这一节是「怎么反查」——从任何一笔记录，都应该能顺着既有的关联栏位，往前或往后追出完整的资金链路。**这不需要新增一张专门的「追溯表」**，纯粹是把已经设计好的关联串起来查询：

```
Booking
  │
  ├─▶ BookingCharge（bookingId）
  │      │
  │      ├─▶ Collection（relatedChargeId，可选，单向）
  │      │
  │      └─▶（经 Revenue Sharing 计算）
  │             │
  │             ▼
  │         WalletTransaction（source=BOOKING_REVENUE，参照 legId）
  │             │
  │             ▼
  │         SettlementItem ──▶ Settlement
  │
  └─▶ TripExpense（bookingId，跟 BookingCharge 平行、互不相干）
         │
         └─▶（若 paidBy=DRIVER 且需要报销）
                │
                ▼
            WalletTransaction（source=TRIP_EXPENSE，参照 tripExpenseId）
                │
                ▼
            SettlementItem ──▶ Settlement
```

**正向追溯**（给定一张 Booking，问「这张 Booking 的钱最终去了哪里」）：Booking → 所有 BookingCharge/TripExpense → 各自可能产生的 WalletTransaction → 各自可能被包进的 Settlement。

**反向追溯**（给定一笔 Settlement，问「这次结算的钱是从哪来的」）：Settlement → SettlementItem → WalletTransaction → 依 Source 分类 → 参照回 Leg（进而回到 BookingCharge/Booking）或 TripExpense。

这个能力不需要额外的表，前提是：`WalletTransaction` 要带 Source + 参照 id（第 8 节新增）、`Collection.relatedChargeId` 要存在（第 6 节既有设计）。反查逻辑本身留到 Backend API 设计阶段再决定要不要做成一支专门的「Booking 财务总览」查询 API（见第 14 节）。

---

## 13. 已确认的业务规则清单

1. `Booking.totalAmountCents`（客户应付总额）= `SUM(未冲销的 BookingCharge.amountCents)`，不再是可编辑栏位。
2. 只有 `ChargeType.participatesInRevenueSharing = true` 的 Charge 参与 Revenue Sharing（初始：Fare + 三种 Surcharge + Extra Stop + Waiting Time）。
3. Personal Tip 100% 归司机，不属于 Company Revenue，不参与 Revenue Sharing。
4. Discount 架构预留（`chargeTypeId` 可指向），不实现任何计算逻辑，也不 Seed 资料。
5. Collection 只记录实际收款/代收/代付/退款，跟 Booking Charge 是两个独立概念，不合并。
6. Collection 可以透过 `relatedChargeId` 单向关联到 BookingCharge，不代表金额一定要相等，纯粹是核对用的标注。
7. BookingCharge 完全不知道 Collection 存在，不反向关联。
8. Booking Charge 记录客户应付项目；Trip Expense 记录公司/司机行程支出；两者完全分离。
9. Trip Expense 不增加 Customer Total（不计入 Booking Total）。
10. Trip Expense 不参与 Commission/Revenue Sharing。
11. Trip Expense 第一版 `paidBy` 只支持 `COMPANY` / `DRIVER`，不支持 `MANAGER`。
12. `paidBy=DRIVER` 且 `reimbursementRequired=true` 才会产生 Wallet Transaction（新 Type：`EXPENSE_REIMBURSEMENT`）。
13. `paidBy=COMPANY` 纯记账，不影响任何人的 Wallet。
14. Wallet 一律 Append Only，`SETTLED` 的 Transaction 永远不会被改回 `PENDING` 或修改。
15. Settlement 不修改任何历史记录，Void 只新增反向 Transaction。
16. `BookingCharge` / `TripExpense` / `WalletTransaction` / `Collection` 一旦建立，金额栏位不可修改，只能新增或冲销（整个 Financial Module 统一遵守 Append Only 原则）。
17. Charge Type 的 Revenue Rule（`isCompanyRevenue` / `participatesInRevenueSharing`）是数据，不是写死在代码里的判断；新增 Charge Type 不需要修改业务逻辑。
18. `participatesInRevenueSharing = true` 时，`isCompanyRevenue` 不生效（已经是拆分的，不是二选一）。
19. 所有 Charge/Expense 的新增跟冲销都要写 Audit Log。
20. 已 `VERIFIED` 或已牵涉 Settlement 的 Expense 不能直接修改，只能 Void 后重建。
21. Booking 原本「有收入历史就锁死总价/抽成」的规则拿掉，改成「记录不能改，只能加」的通用规则。
22. Booking 新增一个独立于营运 `status` 之外的财务状态 `financialStatus`（`OPEN`/`ACCRUING`/`FINALIZED`/`VOIDED`），两者并行存在，`financialStatus` 同样是派生值，不能手动设定。
23. Revenue Sharing Snapshot **只在** Booking `financialStatus` 进入 `FINALIZED` 时产生，唯一触发点；Leg 完成时的 `LEG_EARNING` 走即时计算，不产生 Snapshot。
24. Trip Expense 的状态机是 `PENDING → VERIFIED/REJECTED`，`VERIFIED` 之后视情况再到 `REIMBURSED`，或人工 `VOIDED`；`REJECTED`/`REIMBURSED`/`VOIDED` 都是终态。
25. Collection 支持 Partial Collection：`Expected`/`Received`/`Outstanding` 都是衍生计算，`Received` 是同一组底下所有实际收款记录的加总，不是回头修改一笔记录的金额。
26. 每笔 Wallet Transaction 除了既有的 Type，还要分类一个 Source（`BOOKING_REVENUE`/`TRIP_EXPENSE`/`MANUAL`/`SETTLEMENT_CORRECTION`），并带一个指回源头记录的参照，让资金链路可以被追溯。
27. Financial Principles（Append Only、Snapshot、Audit Everything、Integer Cents、Single Rounding Point、No Client-Trusted Amounts、Reversal over Deletion、Concurrency Safety）是整个 Financial Module 的共同原则，不是某个 Module 各自的规定。
28. `FINALIZED` 之后：不允许修改原有 Charge；如需补差额，只能新增 Adjustment Charge（一样照 `ChargeType` 规则跑 Revenue Sharing、产生自己的 Wallet 效果）；不会重新计算或覆写已经产生的 `FINALIZED` Snapshot，历史收入数字永久不变。
29. 每个 Leg 是独立的 Financial Unit：独立完成、独立用当下的即时 Revenue Sharing 计算产生 `LEG_EARNING`、独立进各自司机的 Wallet、独立跟着各自司机的 Daily Settlement 周期结算——不需要等整张 Booking 的所有 Leg 都完成，也不受 Booking `financialStatus` 是否 `FINALIZED` 影响（去程 Driver A 可以在回程 Driver B 完成前就已经收到钱、甚至已经被结算）。

---

## 14. 尚未决定的业务规则

1. `BUY_ITEM` / `QUEUE` / `DOCUMENT_DELIVERY` 这三个 Charge Type 的 `isCompanyRevenue` 实际值——目前只是我给的业务合理建议，不是你确认过的决定。
2. Discount 的实际归属规则（Company Discount / Manager Discount / Driver Discount / Shared Discount）——完全没设计，只留 `chargeTypeId` 可以指向的架构位置。
3. Manager 垫付报销机制——第一版不支持，未来独立 Expense Claim Module（Claim/Approval/Reject/Reimbursement/Payment）的规格完全没设计。
4. Company Revenue 报表/汇总画面——这次设计让报表变得可能（有了干净的 Ledger），但报表本身（区间营收、各 Charge Type 占比）完全没设计，是未来的 Module。
5. BookingCharge/TripExpense 的 API 权限——哪个角色可以新增 Charge、谁可以记录/Verify TripExpense，是沿用现有 RBAC 权限矩阵还是要新增 Permission Key，还没讨论过。
6. 既有 `Booking.totalAmountCents` 转成第一笔 `FARE` Charge 的 Migration 细节——只谈了概念（backfill 一笔 Charge），没谈实际步骤，例如既有 Booking 的 commission snapshot 要变成 FARE Charge 自己的 `commissionType`/`Value`，还是继续读 Booking 层级的默认值。
7. Leg 完成、已经产生 `LEG_EARNING` 之后，若又新增/冲销影响 Driver Pool 总额的 Charge，除了「不能冲销到低于已分配金额」的下限保护之外，Admin 端要不要有提示/通知「Driver Pool 总额已变动，还有未分配余额需要处理」——UI/通知层面没有讨论过。
8. `TripExpense.expenseType` 是否也要跟 `ChargeType` 一样改成数据驱动（可配置），还是维持第一版固定 enum（`TOLL`/`PARKING`/`FUEL`/`OTHER`）——没有讨论过，目前维持固定 enum 的假设。
9. 一张 Booking 是否允许多笔 `FARE` Charge（例如去程/回程各自一笔），如果允许，每笔是否可以套用不同的 Commission %——概念上支持（`commissionType`/`Value` 已设计成可以每笔覆盖），但没有明确讨论使用场景跟 UI 呈现方式。
10. `financialStatus` 的具体触发时机还没有讨论 edge case，例如 Leg 被取消（不是完成）算不算触发 `ACCRUING`、部分 Leg 被取消后 `FINALIZED` 的判断要不要跟着调整。
11. Revenue Sharing Snapshot 的实际存放方式——是一张新表（每次触发都新增一笔），还是附挂在 `WalletTransaction`/`Booking` 身上当 JSON 栏位，没有讨论过储存形式。
12. Partial Collection 的「分组」机制怎么设计——用自我关联（第一笔当父记录）还是独立的 Expectation 概念，没有决定。
13. Money Reference Trace 要不要做成一支专门的「Booking 财务总览」查询 API，还是只是概念上「可以查得到」，没有讨论优先级。
14. `FINALIZED` 之后新增的 Adjustment Charge 要不要有专门的标记/分类（方便报表区分「原始收入」跟「事后调整」），还是就是一笔普通的 `BookingCharge`、没有特殊标记——没有讨论过。
15. Multi-Leg 场景下，Driver Pool 是全 Booking 共用的一份总额（多数 Charge 是 Booking 层级共用，不挂在特定 `legId`），「先完成的 Leg 先拿钱」是既有系统本来就有的行为（Admin 自己控制 `earningAllocationCents` 总和不超过 Driver Pool），这次沿用不变；但没有讨论「多个 Leg 同时抢同一个 Pool、后完成的 Leg 可能分配余额不足」要不要有额外的实务提示。

---

本文件只是设计定案，**尚未开始任何代码改动**。确认无误后，下一步会是：Database Schema 细节设计 → Migration 计划 → Backend API → Frontend → Tests → Documentation，逐步走完整流程，且会在每个阶段前再次确认范围。

---

## 15. Future Business Scenarios（未来业务场景）

以下场景**目前都还没开发**，只记录未来可能的扩充方向跟大概会碰到架构里的哪一块，**不在这份文件里设计资料库栏位**——真正要做的时候，各自会是独立的设计讨论。

| 场景 | 大概会碰到哪些 Module | 方向备注 |
|---|---|---|
| **Booking 改价** | Booking Charge | 现有的 Append Only 设计已经支援「新增一笔 Charge」来调整总价；但如果是「把某笔 Charge 的金额改小」，要用冲销 + 重开一笔，还是允许在特定条件下直接改，需要另外讨论 |
| **顾客取消** | Booking / Booking Charge / Refund | 取消发生在 Charge 已确认之后，可能需要一个「取消费」Charge Type，以及跟 Refund 场景的衔接 |
| **Driver 取消** | Leg / Dispatch / Wallet | 主要影响的是 Leg 重新指派的既有机制，财务面可能牵涉到「是否要扣司机的某种处罚」，目前没有对应概念 |
| **Refund（退款）** | Collection / Booking Charge | 概念上比较接近 Collection 既有说过要处理的「退款」场景（见第 6 节），是不是要跟 Booking Charge 的冲销机制打通，需要另外设计 |
| **Driver Tip** | Booking Charge（`PERSONAL_TIP`） | 目前的 `PERSONAL_TIP` Charge Type 就是为这个场景准备的（客户给司机的小费），已经在第 4 节确认归属 |
| **Manager Tip** | 未定 | 跟 Driver Tip 是不同资金方向（管理层给司机的奖励，不是客户付的钱），不属于 Booking Charge（客户应付项目），可能需要独立于 Booking 之外的一种奖励/激励 Ledger |
| **Dispatcher Incentive** | 未定 | 概念上是「公司发给内部员工的奖励」，不是客户或 Booking 产生的资金流，可能需要一个跟 Booking 完全脱钩的「员工激励」模块，不属于这次四本 Ledger 的任何一本 |
| **Voucher（代金券）** | Booking Charge（`DISCOUNT`） | 跟第 4 节预留但未实现的 `DISCOUNT` Charge Type 关系最近，但 Voucher 通常还需要「核销/额度/有效期」的概念，比单纯的折扣金额复杂，需要另外设计 |
| **Promo Code（优惠码）** | Booking Charge（`DISCOUNT`） | 跟 Voucher 类似，但是以「码」为核心（生成、验证、使用次数限制），业务模型不完全相同，需要分开讨论 |
| **Airport Fee** | Booking Charge（新 Charge Type） | 结构上就是新增一笔 `ChargeType` 资料（`isCompanyRevenue`/`participatesInRevenueSharing` 待业务决定），不需要新的架构 |
| **Waiting Charge** | Booking Charge（`WAITING_TIME`） | 第 4 节已经建议 Seed 这个 Charge Type（预设参与 Revenue Sharing），等实际开发时确认 |
| **Extra Stop** | Booking Charge（`EXTRA_STOP`） | 同上，第 4 节已经建议 Seed |
| **多公司 Revenue Rule** | Company Settings / Revenue Sharing | 目前 Commission 设定是单一公司层级（`CompanySettings` 单例表）；如果要支援多公司/多分公司各自不同的抽成规则，`CompanySettings` 需要从单例表变成可以有多笔，Revenue Sharing 计算要多一层「这张 Booking 属于哪家公司」的判断，是比较大的架构调整 |
| **多币种（未来预留）** | Company Settings / 全部金额栏位 | 现在系统所有金额都是单一币别的整数 cents（`CompanySettings.currency` 目前只是一个显示用的字符串）；真正的多币种需要汇率、每笔交易记录当下币别，会影响 Booking Charge/Trip Expense/Collection/Wallet/Settlement 全部栏位，是全系统等级的改动，目前只先确认这是已知的未来方向 |

这些场景暂时都不安排开发顺序，等实际要做某一个的时候，会针对那一个场景单独展开设计讨论（跟这份文件走一样的流程：先设计、确认后才动代码）。
