# Collection Module 设计文档 v1

> **状态：设计讨论定案，尚未开始开发。不包含 Schema 变更或 API 设计，纯粹厘清业务边界与资金流向，作为之后 Schema/API 阶段的依据。**
>
> 前置阅读：[financial-model-v2.md](./financial-model-v2.md) 第 6 章已经对 Collection 做过第一版设计（职责边界、`relatedChargeId`、Partial Collection 的 Expected/Received/Outstanding 概念）。本文档在那份基础上补齐使用者这次要求的 10 个主题，并把其中还没决定的地方明确列出来，而不是替使用者悄悄做决定。
>
> **v1.1 更新**：确认 Collection / Wallet 是两个永不互相更新的独立 Ledger；新增 `Collected By`（谁收的钱，与 Payment Method 是两个独立维度，第一版支持 `DRIVER`/`COMPANY`，未来扩充 `THIRD_PARTY`）与 `Receiver`（在 Collected By 这个大类底下，具体是哪一个收款主体）两个字段的设计。

### 三本 Ledger 各自回答一个问题

> **Collection 永远回答：「谁收了多少钱。」**
> **Wallet 永远回答：「公司欠司机多少钱。」**
> **Settlement 永远回答：「最后谁应该给谁多少钱。」**

这三句话是整个 Collection Module 设计的核心前提，贯穿以下所有章节：Collection 与 Wallet 各自独立记账、互不更新（[第 3 章](#3-collection-与-wallet-的关系)），只有 Settlement 负责把两本账放在一起做最终的净额计算（[第 4 章](#4-collection-与-settlement-的关系)）。

## 目录

1. [Collection 的职责](#1-collection-的职责)
2. [Collection 与 Booking Charge 的关系](#2-collection-与-booking-charge-的关系)
3. [Collection 与 Wallet 的关系](#3-collection-与-wallet-的关系)
4. [Collection 与 Settlement 的关系](#4-collection-与-settlement-的关系)
5. [Collection 生命周期（Pending → Verified → Closed）](#5-collection-生命周期pending--verified--closed)
6. [Partial Collection（分次收款）](#6-partial-collection分次收款)
7. [付款方式（Payment Method）](#7-付款方式payment-method)
8. [Collected By 与 Receiver（谁收的钱、钱到了谁手上）](#8-collected-by-与-receiver谁收的钱钱到了谁手上)
9. [Audit Log](#9-audit-log)
10. [Future 扩充（Refund、Adjustment、Bad Debt）](#10-future-扩充refundadjustmentbad-debt)
11. [资金流总览](#11-资金流总览)
12. [尚未决定的业务规则](#12-尚未决定的业务规则)

---

## 1. Collection 的职责

Collection 是**第二本独立的 Ledger**：记录「谁、什么时候、用什么方式，替公司收了多少钱」。它跟 Wallet（公司欠 Driver 多少钱）是两本完全不同方向的账，也跟 Trip Expense（Driver/公司自己垫的支出）严格分离——Collection **不知道 Trip Expense 存在**，这两本账永远不合并。

| Collection 负责什么 | Collection 不负责什么 |
|---|---|
| 记录一笔钱「实际被收到」这个事件（谁收的、何时、金额、方式、凭证） | 计算这笔钱**应该**收多少（那是 [Booking Charge](#2-collection-与-booking-charge-的关系) 的职责） |
| 明确记录 `Collected By`（谁的角色收的：Driver / Company / 未来的 Third Party）与 `Receiver`（这个角色底下具体是哪一个收款主体，见 [第 8 章](#8-collected-by-与-receiver谁收的钱钱到了谁手上)） | 决定 Driver 应该拿到多少收入分成（那是 Revenue Sharing / Wallet 的职责，见 [第 3 章](#3-collection-与-wallet-的关系)） |
| 追踪这笔钱从「收到」到「核实」到「结算完毕」的状态变化 | 计算 Driver 最终净额该收该付多少（那是 Settlement 的职责，见 [第 4 章](#4-collection-与-settlement-的关系)） |
| 支持分次收款（Partial Collection），追踪 Expected / Received / Outstanding | 记录 Driver/公司自己垫付的费用（Trip Expense 的职责，两本账不合并） |
| 保留完整的收款凭证（proof image）与核实记录 | 直接修改历史记录（Append-Only 原则同样适用，见 [financial-model-v2.md 第 2 章](./financial-model-v2.md)） |
| 提供 Void（作废）机制处理收错、重复登记等异常 | |

---

## 2. Collection 与 Booking Charge 的关系

`BookingCharge` 代表「这张 Booking 应该收多少钱」（价格构成），`Collection` 代表「实际收到了多少钱」（收款事件）。两者是**单向、可选**的关联：`Collection.relatedChargeId` 可以指向一笔 `BookingCharge`，但只作为**对账备注**用途——不会有反向关联，也不做金额一致性校验。

```
BookingCharge（应该收多少）              Collection（实际收了多少）
┌─────────────────────┐                ┌─────────────────────┐
│ chargeType: PARCEL   │  - - - - - ▶   │ purpose: PARCEL      │
│ amountCents: 5000    │  relatedChargeId │ amountCents: 5000   │
└─────────────────────┘   （可选，仅供   └─────────────────────┘
                            对账参考，
                            不校验金额一致）
```

刻意不做强关联／金额校验的原因：

- 一笔 Collection 可能同时对应多笔 Charge（例如客户一次付清多个额外费用）
- 一笔 Collection 可能完全不对应任何 Charge（例如 Driver 代垫后向客户收取的临时费用，没有事先在 Booking 上列出）
- Partial Collection（[第 6 章](#6-partial-collection分次收款)）本身就代表「实际收款」跟「应收金额」是两条独立追踪的数字，不适合再用外键强制绑死

---

## 3. Collection 与 Wallet 的关系

这是最容易被誤解的一段关系，需要特别说清楚，也是这次设计讨论中被明确定案的一条规则：

> **Collection 与 Wallet 是两本完全独立、方向相反的 Ledger。两者不会互相更新——没有任何一笔 Collection 记录会写入 Wallet，也没有任何一笔 Wallet 记录会写入 Collection。两本账只在 Settlement 当下被一起「读取」做净额计算，Settlement 才是唯一负责最终对账的地方。**

| | Collection | Wallet |
|---|---|---|
| 回答什么问题 | 「谁收了多少钱」 | 「公司欠司机多少钱」 |
| 代表什么 | Driver/Company **持有**多少属于公司的钱（Driver 欠公司，见 [第 8 章](#8-collected-by-与-receiver谁收的钱钱到了谁手上)） | 公司**欠** Driver 多少钱（收入分成、津贴等） |
| 谁触发新记录 | 收款事件发生（客户付钱，见 [第 8 章](#8-collected-by-与-receiver谁收的钱钱到了谁手上)的 Collected By） | Revenue Sharing Finalize 自动发放（见 [wallet-migration.md](../modules/wallet-migration.md)） |
| 净额方向 | 负债方向：Driver → 公司 | 应付方向：公司 → Driver |
| 会不会写入对方 | ❌ 不会 | ❌ 不会 |

两本账**只在 Settlement 当下才会碰在一起做净额计算**，且只是「读取汇总」，不是「互相写入」——Settlement 不会因为 Collection 而建立 WalletTransaction，也不会因为 Wallet 而建立 Collection。这也是为什么第 11 章的资金流图会特别标注「Collection 与 Wallet 是平行关系，不是串联关系」，以及为什么 Settlement 永远回答的是第三个、也是最后一个问题：「最后谁应该给谁多少钱」。

---

## 4. Collection 与 Settlement 的关系

沿用既有设计（[financial-model-v2.md](./financial-model-v2.md)、[wallet-migration.md](../modules/wallet-migration.md) 已经确认，Collection Module v1 不改变这个机制）：

Settlement 针对某个 Driver、某个结算周期，同时拉两组数据：

1. `WalletTransaction`：`status = PENDING` 的记录加总 → `walletAmountCents`（公司欠 Driver 多少）
2. `Collection`：`status = VERIFIED` 且尚未结算的记录加总 → `collectionAmountCents`（Driver 欠公司多少）

> **随 `Collected By`（[第 8 章](#8-collected-by-与-receiver谁收的钱钱到了谁手上)）新增而更新的规则**：`collectionAmountCents` **只加总 `Collected By = DRIVER` 的记录**。`Collected By = COMPANY`（未来还有 `THIRD_PARTY`）的 Collection，代表 Driver 从未实际持有这笔钱，不构成 Driver 对公司的负债，因此不计入该 Driver 的 Settlement 欠款——这些记录仍然会正常经历 [第 5 章](#5-collection-生命周期pending--verified--closed) 的生命周期（Verified → Settled），只是不进入净额计算的分子。这条规则解决了 v1 初稿[第 12 章](#12-尚未决定的业务规则)原本列为开放问题的「`TRANSFER_TO_COMPANY` 该不该算进 Driver 欠款」。

```
netAmountCents = walletAmountCents - collectionAmountCents

netAmountCents > 0  →  公司要付钱给 Driver
netAmountCents < 0  →  Driver 要把钱还给公司
```

Settlement 确认（Confirm）后，两组记录同时被标记为 `SETTLED`（Collection 额外回填 `settlementId`），生命周期结束（见 [第 5 章](#5-collection-生命周期pending--verified--closed)）。

> **已知限制（沿用自 wallet-migration.md）**：Wallet Migration 新增的 `REVENUE_SHARE_PAYOUT` 类型 WalletTransaction 会自动进入同一组 `PENDING` 拉取逻辑（Settlement 现有查询不按 `transactionType` 过滤），理论上兼容，但尚未针对这个新类型写过 Settlement 端的整合测试。这次 Collection Module 设计不涉及 Settlement 代码改动，此限制留待 Settlement Module 真正开工时验证。

---

## 5. Collection 生命周期（Pending → Verified → Closed）

使用者这次要求的生命周期是 **Pending → Verified → Closed** 三段式，但既有 Schema（`CollectionStatus`）已经实作并测试过 5 个状态：`PENDING / COLLECTED / VERIFIED / SETTLED / VOIDED`。两者不冲突——三段式是**业务概念上的三个阶段**，5 个状态是这三个阶段在系统里的**精确实作**，对照如下：

| 使用者的三段式概念 | 现有 `CollectionStatus` | 说明 |
|---|---|---|
| **Pending**（等待收款） | `PENDING` | Collection 记录已建立（例如 Driver 在 App 上登记「预计要收这笔钱」），但钱还没有实际到手 |
| **Pending**（等待核实） | `COLLECTED` | 钱已经实际收到（现金到手 / 转账入账），但还没有人核实过——细分出这个状态是因为「收到钱」跟「有人核实过这笔钱」在时间上通常不是同一刻发生 |
| **Verified**（已核实） | `VERIFIED` | 已核实，正式承认这笔收款成立，进入可以被 Settlement 拉取结算的池子 |
| **Closed**（已关闭） | `SETTLED` | 已经在某次 Settlement 中被结算掉，生命周期正式结束 |
| （例外分支，不属于三段式主线） | `VOIDED` | 作废——可以从 `PENDING`/`COLLECTED`/`VERIFIED` 任何一个阶段发生，代表这笔记录从一开始就不该存在（登记错误、重复登记等），跟「已达成但事后要处理」的 [Future 扩充](#10-future-扩充refundadjustmentbad-debt) 概念不同 |

```
                    ┌──────────┐
        建立         │ PENDING  │  ← 使用者概念：Pending
        ───────────▶│ (等待收款) │
                    └────┬─────┘
                         │ 实际收到钱
                         ▼
                    ┌──────────┐
                    │COLLECTED │  ← 使用者概念：Pending（细分：等待核实）
                    │(等待核实) │
                    └────┬─────┘
                         │ 核实通过
                         ▼
                    ┌──────────┐
                    │ VERIFIED │  ← 使用者概念：Verified
                    │(进入结算池)│
                    └────┬─────┘
                         │ Settlement 确认
                         ▼
                    ┌──────────┐
                    │ SETTLED  │  ← 使用者概念：Closed
                    │ (已关闭)  │
                    └──────────┘

  任何阶段（PENDING / COLLECTED / VERIFIED）都可以走向：
                    ┌──────────┐
                    │ VOIDED   │  （作废，脱离主线，不进入 Settlement）
                    └──────────┘
```

---

## 6. Partial Collection（分次收款）

沿用 [financial-model-v2.md](./financial-model-v2.md) 已确认的设计：

- 一笔「主 Collection」记录 `expectedAmountCents`（这笔款项总共应该收多少）
- 每一次实际收款是一笔独立的「子 Collection」，透过 `parentCollectionId` 关联回主记录
- 每一笔子 Collection 有自己独立的生命周期（[第 5 章](#5-collection-生命周期pending--verified--closed)），不会因为主记录的状态而连带改变
- `Received so far` = 所有 `VERIFIED`（及之后）状态的子记录 `amountCents` 加总
- `Outstanding` = `expectedAmountCents - Received so far`

```
Collection（主记录，parentCollectionId = null）
├── expectedAmountCents: 10000
│
├── Collection（子记录 #1，parentCollectionId = 主记录.id）
│     amountCents: 4000 / status: VERIFIED
│
├── Collection（子记录 #2，parentCollectionId = 主记录.id）
│     amountCents: 3000 / status: COLLECTED（尚未核实，不计入 Received）
│
└── （尚未发生的第三次收款）

Received so far = 4000（只算 VERIFIED）
Outstanding      = 10000 - 4000 = 6000
```

这部分设计在 v1 阶段视为**已定案、沿用不变**；本文档在 [第 12 章](#12-尚未决定的业务规则) 额外补充一个这次讨论中发现、之前没有明确回答的细节问题（主记录本身要不要能持有 `amountCents`、以及全部收齐后要不要自动转换状态）。

---

## 7. 付款方式（Payment Method）

**Payment Method 只回答「客户怎么付钱」，不回答「谁收到了钱」**——「谁收到了钱」是 [Collected By](#8-collected-by-与-receiver谁收的钱钱到了谁手上) 的职责，两者是刻意分开的正交维度，不混在一起：

```
Payment Method（怎么付）          Collected By（谁收的，见第 8 章）
──────────────────────          ──────────────────────
Cash                             Driver
Bank Transfer                    Company
DuitNow / TNG                    Third Party（未来）
Other
```

在这次讨论之前，既有 `CollectionPaymentMethod` 枚举是 `CASH / TRANSFER_TO_DRIVER / TRANSFER_TO_COMPANY / TNG / OTHER`——`TRANSFER_TO_DRIVER`/`TRANSFER_TO_COMPANY` 其实是把「怎么付」跟「谁收到」两件事揉在同一个值里，这也是为什么 v1 初稿在第 12 章把 `TRANSFER_TO_COMPANY` 该不该算入 Driver 欠款列为开放问题。现在有了独立的 Collected By 维度，Payment Method 可以（也应该）简化成纯粹描述「支付通道」，不再需要用 `_TO_DRIVER`/`_TO_COMPANY` 变体表达收款对象：

| Payment Method（简化建议） | 说明 |
|---|---|
| `CASH` | 现金 |
| `BANK_TRANSFER` | 银行转账（不分转给谁，那是 Collected By/Receiver 的职责） |
| `DUITNOW` | DuitNow（新支付管道，这次讨论中补充） |
| `TNG` | Touch 'n Go 等电子钱包 |
| `OTHER` | 其他方式 |

> 这属于「因为 Collected By 的引入而连带产生的简化」，具体的枚举值改动（是否直接改名既有 `TRANSFER_TO_DRIVER`/`TRANSFER_TO_COMPANY`，还是新增再逐步淘汰）留到 Schema 阶段决定，这里只先定下**概念上要拆干净**这件事。

---

## 8. Collected By 与 Receiver（谁收的钱、钱到了谁手上）

这一章是这次设计讨论新增、且已经定案的核心内容：**Collection 必须明确记录 Collected By，而不是只靠 Payment Method 间接推断「谁收了钱」。**

### 8.1 Collected By：与 Payment Method 是两个独立维度

| 维度 | 回答什么 | 取值（v1） |
|---|---|---|
| **Payment Method**（[第 7 章](#7-付款方式payment-method)） | 客户**怎么**付钱 | Cash / Bank Transfer / DuitNow / TNG / Other |
| **Collected By** | **谁**收了这笔钱（角色层级） | `DRIVER` / `COMPANY`（未来扩充 `THIRD_PARTY`） |

两者可以任意组合，例如「Cash 但 Collected By = COMPANY」（客户直接把现金交给公司柜台，不经过 Driver）在业务上是合理的组合，不应该被 Payment Method 的取值限制住——这正是把两者拆开的意义。

### 8.2 三种 Collected By 与对应流程

#### Driver 代收（v1 支持，现有系统已完整覆盖的路径）

```
客户 ──(付钱给 Driver)──▶ Driver 持有款项
                              │
                         建立 Collection
                       （Collected By = DRIVER）
                              │
                        Pending → Collected → Verified
                              │
                    Settlement：计入 collectionAmountCents
                   （Driver 欠公司，见第 4 章）
```

#### Company 收款（v1 支持，这次明确定案）

```
客户 ──(付钱直接给公司)──▶ 公司持有款项
                              │
                         建立 Collection
                       （Collected By = COMPANY）
                              │
                        Pending → Collected → Verified
                              │
                    Settlement：不计入任何 Driver 的
                    collectionAmountCents（公司本来就有这笔钱，
                    Driver 从未持有，不构成负债——见第 4 章）
```

`driverId` 在这个情境下仍然可以保留（记录这笔钱归属于哪个 Driver 的哪趟行程，方便对账），但明确不影响该 Driver 的 Settlement 净额。

#### 第三方收款（未来扩充，v1 不实作）

例如合作平台代收后统一对账、批量汇给公司；或客户透过第三方支付通道，事后才核销到某张 Booking。`Collected By = THIRD_PARTY` 预留这个扩充方向，但第一版明确**只支持 `DRIVER`/`COMPANY` 两种**，`THIRD_PARTY` 留待真正有这类业务需求时再启用。

### 8.3 Receiver：Collected By 底下更精确的收款主体

`Collected By` 回答的是**角色层级**的「谁」（Driver 这个角色，还是 Company 这个角色），但同一个角色底下可能有多个具体主体——`Receiver` 补上这一层精确度：

```
Collected By：DRIVER
Receiver：    Driver A          （具体是哪一位司机）

Collected By：COMPANY
Receiver：    Company Account A  （具体是公司的哪一个收款账户/主体）
```

| Collected By | Receiver 代表什么 | 对应现有概念 |
|---|---|---|
| `DRIVER` | 具体是哪一位 Driver 收的钱 | 就是既有的 `Collection.driverId`——Receiver 在这里不是全新概念，只是把它跟 Collected By 放在同一个维度下理解 |
| `COMPANY` | 具体是公司的哪一个收款账户/主体收的钱 | **新概念**：现有 Schema 没有「公司收款账户」这个东西，第一版可能只有一个默认的公司主体，但设计上要留扩充空间（例如公司有多个银行账户、多个分公司实体） |
| `THIRD_PARTY`（未来） | 具体是哪一个第三方（合作平台/支付通道名称） | 全新概念，留待启用 THIRD_PARTY 时一并设计 |

Receiver 这一层「具体主体是谁」的设计细节（尤其是 `COMPANY` 底下要不要做成一份结构化的「收款账户」清单，还是先用自由文本记录）本文档标记为**尚未决定**，列在 [第 12 章](#12-尚未决定的业务规则)，留待 Schema 阶段确认。

---

## 9. Audit Log

沿用项目既有模式（[revenue-sharing-api.md](../modules/revenue-sharing-api.md)、[wallet-migration.md](../modules/wallet-migration.md)、[company-settings.md](../modules/company-settings.md) 都是同一套写法：每次关键状态变化都用 `writeAuditLog` 写一笔，`beforeData`/`afterData` 记录变化前后的完整快照，`actorUserId`/`actorRole` 记录操作人，时间自动记录）。

Collection 既有栏位已经预留了大部分需要的追踪信息（`createdBy`、`verifiedAt`/`verifiedBy`、`voidedAt`/`voidedBy`/`voidReason`、`settledAt`/`settlementId`），Audit Log 是在这之上再补一层「事件流水」，让每一次状态转换都有独立、不可篡改的记录（跟栏位本身「只保留最后一次」的性质互补）。建议的 Action Key（比照既有模块命名风格）：

| Action Key | 触发时机 |
|---|---|
| `COLLECTION_CREATED` | 建立 Collection 记录（Pending） |
| `COLLECTION_COLLECTED` | 标记实际收到款项（转入 Collected） |
| `COLLECTION_VERIFIED` | 核实通过（转入 Verified） |
| `COLLECTION_VOIDED` | 作废（记录 `voidReason`） |
| `COLLECTION_SETTLED` | 随 Settlement 确认一并转入 Closed |

---

## 10. Future 扩充（Refund、Adjustment、Bad Debt）

这三项目前都**不在 v1 范围内**，这里只先记录方向，供之后设计时参考，避免现在的 Schema 设计跟未来的扩充方向冲突。

| 扩充项目 | 建议方向 | 理由 |
|---|---|---|
| **Refund**（退款） | 新增一笔金额为负、或带专属 `purpose`/`type` 的 Collection 记录，关联回原记录，而不是修改原记录的金额 | 符合 Append-Only 原则（[financial-model-v2.md 第 2 章](./financial-model-v2.md)：Reversal over Deletion）——历史记录不能被改写，任何更正都用「新增一笔反向记录」表达 |
| **Adjustment**（调整） | 比照 `BookingCharge` 既有的 `adjustmentType` / `adjustsId` / `reason` 模式，为 Collection 做一套对称设计 | 跟现有 Financial 模块保持一致的调整机制，减少认知负担 |
| **Bad Debt**（坏账/收不回） | 新增独立的终态，例如 `WRITTEN_OFF`，而不是沿用 `VOIDED` | `VOIDED` 语意是「这笔记录从一开始就不该存在」（登记错误、重复登记），`WRITTEN_OFF` 语意是「这笔钱本来合法应收，但公司决定放弃追讨」——两者在财务报表/审计上的意义完全不同，混用会让历史报表失真 |

---

## 11. 资金流总览

### 11a. 使用者要求的线性示意图

```
Booking Charge
      │
      ▼
   Collection
      │
      ▼
    Wallet
      │
      ▼
  Settlement
```

### 11b. 更准确的资金流关系（补充说明）

上面的线性图直观、方便理解「这几个模块的先后顺序」，但**不是资金实际流动的准确模型**——Collection 跟 Wallet 之间没有任何一笔资料会互相写入对方（见 [第 3 章](#3-collection-与-wallet-的关系)）。更准确的关系是「两条平行的河，只在 Settlement 这个点汇合做净额计算」：

```
Booking Charge                          Revenue Sharing Finalize
（应该收多少 / 应该分多少）                （自动发放，见 wallet-migration.md）
      │                                          │
      │ relatedChargeId（可选，仅供对账）           │
      ▼                                          ▼
  Collection                                  Wallet
（Driver 持有多少属于公司的钱）              （公司欠 Driver 多少钱）
  Pending → Collected → Verified              PENDING
      │                                          │
      │ VERIFIED 且未结算                          │ PENDING
      └──────────────────┬───────────────────────┘
                          ▼
                     Settlement
          netAmountCents = walletAmountCents − collectionAmountCents
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      Collection → SETTLED    WalletTransaction → SETTLED
        （生命周期 Closed）        （标记已结算）
```

两条河互不干涉，各自累积；Settlement 是唯一的汇合点，且只做「读取汇总、净额计算、双方标记已结算」，不产生新的 Collection 或 Wallet 记录（Refund/Adjustment 等未来扩充机制除外，见 [第 10 章](#10-future-扩充refundadjustmentbad-debt)）。

---

## 12. 尚未决定的业务规则

比照 [financial-model-v2.md](./financial-model-v2.md) 的做法，以下问题这次讨论中被发现但还没有答案，明确列出来等待确认，而不是在设计文档里悄悄替使用者做决定。

> **v1.1 更新**：以下三项在 v1 初稿列为开放问题，这次已经由使用者明确定案，从开放问题移除，改写进正式章节——① Collected By/Payment Method 拆成两个独立维度（[第 8 章](#8-collected-by-与-receiver谁收的钱钱到了谁手上)）② `Collected By` 第一版支持 `DRIVER`/`COMPANY`，`THIRD_PARTY` 留待未来 ③ `COMPANY`（未来 `THIRD_PARTY`）收款不计入 Driver 的 Settlement 欠款（[第 4 章](#4-collection-与-settlement-的关系)）。

1. **Receiver 在 `Collected By = COMPANY` 底下要不要做成结构化的「公司收款账户」清单，还是先用自由文本记录？**（[第 8.3 节](#83-receivercollected-by-底下更精确的收款主体)）如果公司未来会有多个银行账户/多个分公司实体收款，自由文本没办法做报表汇总统计；但如果第一版只有单一公司主体，结构化清单可能是过度设计。需要使用者确认第一版的实际情境。

2. **Partial Collection 的每一笔子记录，Collected By/Receiver 是否可以互相不同？**（[第 6 章](#6-partial-collection分次收款)）例如同一笔应收款，客户第一次把现金给了 Driver（Collected By = DRIVER），第二次尾款直接转给公司（Collected By = COMPANY）——这次讨论新增 Collected By 后浮现的边界情况，v1 初稿没有涉及，需要确认是否要支持这种混合情境。

3. **Partial Collection 的主记录本身要不要能持有金额？全部子记录收齐后要不要自动转换主记录状态？**（[第 6 章](#6-partial-collection分次收款)）现有设计只讲清楚了主记录的 `expectedAmountCents` 跟子记录的加总计算，没有讲清楚「收齐之后发生什么」。

4. **`CollectionPurpose`（`TOLL`/`PARKING`）与 Trip Expense 的 `TripExpenseType`（`TOLL`/`PARKING`/`FUEL`/`OTHER`）名称重叠，是否需要改名以避免混淆？** 两者代表的是完全不同方向的事件（Collection 的 `TOLL`/`PARKING` 是「向客户收取的过路费/停车费」，Trip Expense 的同名值是「Driver/公司自己垫付的过路费/停车费」），业务上不会混用，但名称相同容易在代码/报表阅读时造成误解——是否要改名成更明确的形式（例如 Collection 端改成 `TOLL_REIMBURSEMENT`）留待确认。

5. **Refund / Adjustment / Bad Debt 的具体实作机制**（[第 10 章](#10-future-扩充refundadjustmentbad-debt)）目前只给出方向性建议，具体的 Schema 设计（新增枚举值、新增栏位、还是新增独立 Model）留到真正要做这几项扩充时再定案。

6. **Payment Method 既有枚举值（`TRANSFER_TO_DRIVER`/`TRANSFER_TO_COMPANY`）要不要直接改名简化，还是新增简化版本后逐步淘汰旧值？**（[第 7 章](#7-付款方式payment-method)）属于 Schema 阶段的实作细节，这里只先定下概念上要把「怎么付」跟「谁收」拆干净的方向。
