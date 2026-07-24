import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Select, Space, Tag, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useDriversQuery } from "../drivers/hooks";
import { useConfirmSettlementMutation, useSettlementPreviewQuery } from "./hooks";
import { TYPE_LABEL } from "../wallet/components/WalletTransactionTable";
import { PURPOSE_LABELS } from "../collections/types";
import type { WalletTransaction, WalletTransactionStatus } from "../wallet/types";
import type { Collection, CollectionStatus } from "../collections/types";
import { formatCents } from "../../lib/money";
import { PermissionGate } from "../auth/PermissionGate";
import { PERMISSIONS } from "../../common/permissions";

const WALLET_STATUS_COLOR: Record<WalletTransactionStatus, string> = {
  PENDING: "gold",
  SETTLED: "success",
  VOIDED: "default"
};

const COLLECTION_STATUS_COLOR: Record<CollectionStatus, string> = {
  PENDING: "default",
  COLLECTED: "gold",
  VERIFIED: "blue",
  SETTLED: "success",
  VOIDED: "error"
};

// 「排除原因」目前只可能是 Before Period / After Period：Backend 的 getTransactionsOutsidePeriod /
// getCollectionsOutsidePeriod 本来就只抓 status=PENDING（Wallet）/ VERIFIED（Collection）的资料，
// 已经 SETTLED/VOIDED 的项目从一开始就不会出现在这个列表里，所以「Already Settled / Voided /
// Invalid Status」这几种原因在目前的资料形状下不会真的发生——不为它们编造判断逻辑。
function excludedReason(dateStr: string, periodStart: string, periodEnd: string): string {
  const d = dayjs(dateStr);
  if (d.isBefore(dayjs(periodStart), "day")) return "Before Period（早于所选周期）";
  if (d.isAfter(dayjs(periodEnd), "day")) return "After Period（晚于所选周期）";
  return "—";
}

// Mobile UAT Bug Fix（Driver Collection 纳入 Settlement）：Backend 的 excludedCollections
// 现在混合了两种不同原因的资料——日期落在周期外（status=VERIFIED），或还没被 Admin Verify
// （status=COLLECTED，不管日期，见 collection.service.ts 的 getUnverifiedCollections）。
// 用 status 先分辨，不能只看日期，否则「收款尚未审核」的项目会被误判成日期落在周期内、
// 显示排除原因「—」，等于又变相静默忽略。
function excludedCollectionReason(collection: Collection, periodStart: string, periodEnd: string): string {
  if (collection.status === "COLLECTED") return "收款尚未审核（Verify Pending）";
  return collection.collectedAt ? excludedReason(collection.collectedAt, periodStart, periodEnd) : "—";
}

// 跟 Backend settlement.service.ts 的 summarizeWallet 用同一套分类逻辑（LEG_EARNING/
// REVENUE_SHARE_PAYOUT 算司机完成行程的收入，其余按正负分类成 Adjustment）——这里只是
// 本地重算一次「目前勾选的这些项目」的小计，Confirm 送出的最终金额一律由 Backend 用同一套
// 规则重新算一次，前端这份只用来即时显示，不是最终依据。
function summarizeSelection(transactions: WalletTransaction[], collections: Collection[]) {
  let completedLegEarningsCents = 0;
  let positiveAdjustmentsCents = 0;
  let negativeAdjustmentsCents = 0;

  for (const tx of transactions) {
    if (tx.transactionType === "LEG_EARNING" || tx.transactionType === "REVENUE_SHARE_PAYOUT") {
      completedLegEarningsCents += tx.amountCents;
    } else if (tx.amountCents >= 0) {
      positiveAdjustmentsCents += tx.amountCents;
    } else {
      negativeAdjustmentsCents += tx.amountCents;
    }
  }

  const walletAmountCents = completedLegEarningsCents + positiveAdjustmentsCents + negativeAdjustmentsCents;
  const collectionAmountCents = collections.reduce((sum, c) => sum + c.amountCents, 0);

  return {
    positiveAdjustmentsCents,
    negativeAdjustmentsCents,
    walletAmountCents,
    collectionAmountCents,
    netAmountCents: walletAmountCents - collectionAmountCents
  };
}

function ExcludedWalletCards({
  items,
  periodStart,
  periodEnd
}: {
  items: WalletTransaction[];
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      {items.map((tx) => (
        <Card key={tx.id} size="small">
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Typography.Text>Booking：{tx.booking ? `#${tx.booking.id} ${tx.booking.girlName}` : "-"}</Typography.Text>
            <Typography.Text>Leg：{tx.leg ? `Leg ${tx.leg.sequence}` : "-"}</Typography.Text>
            <Typography.Text>Type：{TYPE_LABEL[tx.transactionType]}</Typography.Text>
            <Typography.Text>Amount：{formatCents(tx.amountCents)}</Typography.Text>
            <Typography.Text>Effective Date：{dayjs(tx.effectiveDate).format("YYYY-MM-DD")}</Typography.Text>
            <Typography.Text>Status：{tx.status}</Typography.Text>
            <Typography.Text type="warning">排除原因：{excludedReason(tx.effectiveDate, periodStart, periodEnd)}</Typography.Text>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

function ExcludedCollectionCards({
  items,
  periodStart,
  periodEnd
}: {
  items: Collection[];
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      {items.map((c) => (
        <Card key={c.id} size="small">
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Typography.Text>Booking：{c.booking ? `#${c.booking.id} ${c.booking.girlName}` : "-"}</Typography.Text>
            <Typography.Text>Leg：{c.leg ? `Leg ${c.leg.sequence}` : "-"}</Typography.Text>
            <Typography.Text>Type：{PURPOSE_LABELS[c.purpose]}</Typography.Text>
            <Typography.Text>Amount：{formatCents(c.amountCents)}</Typography.Text>
            <Typography.Text>Effective Date：{c.collectedAt ? dayjs(c.collectedAt).format("YYYY-MM-DD") : "-"}</Typography.Text>
            <Typography.Text>Status：{c.status}</Typography.Text>
            <Typography.Text type="warning">排除原因：{excludedCollectionReason(c, periodStart, periodEnd)}</Typography.Text>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

// Selective Settlement（功能五）：每笔 Available 项目一张 Card + Checkbox，手机/桌面共用同一份
// 排版（不用 Table），跟既有 Excluded*Cards 的风格保持一致。全选/取消全选放在列表上方的小工具列。
function SelectableWalletCards({
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll
}: {
  items: WalletTransaction[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      <Space wrap>
        <Button size="small" onClick={onSelectAll}>
          全选
        </Button>
        <Button size="small" onClick={onDeselectAll}>
          取消全选
        </Button>
      </Space>
      {items.map((tx) => (
        <Card key={tx.id} size="small">
          <Space align="start" style={{ width: "100%" }}>
            <Checkbox checked={selectedIds.has(tx.id)} onChange={() => onToggle(tx.id)} style={{ marginTop: 4 }} />
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              <Typography.Text>Booking：{tx.booking ? `#${tx.booking.id} ${tx.booking.girlName}` : "-"}</Typography.Text>
              <Typography.Text>Leg：{tx.leg ? `Leg ${tx.leg.sequence}` : "-"}</Typography.Text>
              {tx.driver && <Typography.Text>Driver：{tx.driver.name}</Typography.Text>}
              <Typography.Text>Type：{TYPE_LABEL[tx.transactionType]}</Typography.Text>
              <Typography.Text strong>Amount：{formatCents(tx.amountCents)}</Typography.Text>
              <Typography.Text type="secondary">Effective Date：{dayjs(tx.effectiveDate).format("YYYY-MM-DD")}</Typography.Text>
              <Tag color={WALLET_STATUS_COLOR[tx.status]}>{tx.status}</Tag>
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

function SelectableCollectionCards({
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll
}: {
  items: Collection[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      <Space wrap>
        <Button size="small" onClick={onSelectAll}>
          全选
        </Button>
        <Button size="small" onClick={onDeselectAll}>
          取消全选
        </Button>
      </Space>
      {items.map((c) => (
        <Card key={c.id} size="small">
          <Space align="start" style={{ width: "100%" }}>
            <Checkbox checked={selectedIds.has(c.id)} onChange={() => onToggle(c.id)} style={{ marginTop: 4 }} />
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              <Typography.Text>Booking：{c.booking ? `#${c.booking.id} ${c.booking.girlName}` : "-"}</Typography.Text>
              <Typography.Text>Leg：{c.leg ? `Leg ${c.leg.sequence}` : "-"}</Typography.Text>
              <Typography.Text strong>Amount：{formatCents(c.amountCents)}</Typography.Text>
              <Typography.Text type="secondary">Payment Method：{c.paymentMethod}</Typography.Text>
              <Typography.Text type="secondary">
                Collected Time：{c.collectedAt ? dayjs(c.collectedAt).format("YYYY-MM-DD HH:mm") : "-"}
              </Typography.Text>
              <Tag color={COLLECTION_STATUS_COLOR[c.status]}>{c.status}</Tag>
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

export function DailySettlementPage() {
  const [driverId, setDriverId] = useState<number | undefined>(undefined);
  const [period, setPeriod] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<number>>(new Set());
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<number>>(new Set());

  const { data: drivers } = useDriversQuery();
  const periodStart = period[0].format("YYYY-MM-DD");
  const periodEnd = period[1].format("YYYY-MM-DD");
  const { data: preview, isFetching } = useSettlementPreviewQuery(driverId, periodStart, periodEnd);
  const confirmSettlement = useConfirmSettlementMutation();

  // 「日期范围只是筛选/发现工具，不是强制纳入」：每次 Preview 换了一批 Available 项目
  // （换 Driver、换周期），预设自动选择「全部待结算」（等同旧版整个周期全部结算的行为），
  // Admin 可以再自己取消勾选特定项目，留到下次结算。
  useEffect(() => {
    if (!preview) return;
    setSelectedTxIds(new Set(preview.transactions.map((tx) => tx.id)));
    setSelectedCollectionIds(new Set(preview.collections.map((c) => c.id)));
  }, [preview]);

  function toggleTx(id: number) {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCollection(id: number) {
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!driverId) return;
    const settlement = await confirmSettlement.mutateAsync({
      driverId,
      periodStart,
      periodEnd,
      selectedWalletTransactionIds: [...selectedTxIds],
      selectedCollectionIds: [...selectedCollectionIds]
    });
    message.success(`日结完成，Reference: ${settlement.reference}`);
  }

  const availableCount = (preview?.transactions.length ?? 0) + (preview?.collections.length ?? 0);
  const excludedCount = (preview?.excludedTransactions.length ?? 0) + (preview?.excludedCollections.length ?? 0);
  const selectedCount = selectedTxIds.size + selectedCollectionIds.size;
  const hasNothingAvailable = availableCount === 0;
  const hasNothingSelected = selectedCount === 0;

  // preview 同时回传「周期内」跟「周期外」的项目，两者合起来就是这个 Driver 目前全部
  // PENDING/VERIFIED 的待结算资料——不管当前选的周期是什么，都能从这份资料算出
  // 「最早/最晚未结算日期」，不需要另外呼叫 API。
  const { earliestUnsettled, latestUnsettled } = useMemo(() => {
    if (!preview) return { earliestUnsettled: null as Dayjs | null, latestUnsettled: null as Dayjs | null };
    const txDates = [...preview.transactions, ...preview.excludedTransactions].map((t) => dayjs(t.effectiveDate));
    // 还没 Verify 的 Collection（status=COLLECTED）不受周期限制，扩大日期范围也没办法让它们
    // 被结算（还是得先去 Verify）——排除它们，避免「选择全部未结算日期」被一笔很旧的
    // 待审核代收款拉出一个没有意义的超长日期范围。
    const colDates = [...preview.collections, ...preview.excludedCollections]
      .filter((c) => c.status !== "COLLECTED")
      .map((c) => c.collectedAt)
      .filter((d): d is string => Boolean(d))
      .map((d) => dayjs(d));
    const all = [...txDates, ...colDates];
    if (all.length === 0) return { earliestUnsettled: null, latestUnsettled: null };
    return {
      earliestUnsettled: all.reduce((min, d) => (d.isBefore(min) ? d : min)),
      latestUnsettled: all.reduce((max, d) => (d.isAfter(max) ? d : max))
    };
  }, [preview]);

  function selectAllUnsettled() {
    if (earliestUnsettled && latestUnsettled) {
      setPeriod([earliestUnsettled, latestUnsettled]);
    }
  }

  function selectToday() {
    setPeriod([dayjs(), dayjs()]);
  }

  function selectYesterday() {
    const y = dayjs().subtract(1, "day");
    setPeriod([y, y]);
  }

  function selectThisWeek() {
    setPeriod([dayjs().startOf("week"), dayjs().endOf("week")]);
  }

  // 即时依「目前勾选的项目」重算，不是整个周期的总额——这才是 Confirm 按下去实际会送出、
  // Backend 会重新验证跟重算的那笔金额。
  const selectionSummary = useMemo(() => {
    if (!preview) return null;
    const selectedTx = preview.transactions.filter((tx) => selectedTxIds.has(tx.id));
    const selectedCollections = preview.collections.filter((c) => selectedCollectionIds.has(c.id));
    return summarizeSelection(selectedTx, selectedCollections);
  }, [preview, selectedTxIds, selectedCollectionIds]);

  const netAmountCents = selectionSummary?.netAmountCents ?? 0;
  const settlementResult =
    !preview || hasNothingSelected || netAmountCents === 0
      ? { type: "info" as const, message: "Nothing to Settle（没有需要结算的净额）" }
      : netAmountCents > 0
        ? { type: "success" as const, message: `Company Pays Driver ${formatCents(netAmountCents)}` }
        : { type: "warning" as const, message: `Driver Returns Company ${formatCents(-netAmountCents)}` };

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>Daily Settlement</Typography.Title>

      <Space style={{ marginBottom: 8 }} wrap>
        <Select
          placeholder="选择 Driver"
          style={{ width: 200 }}
          options={drivers?.map((driver) => ({ label: driver.name, value: driver.id }))}
          value={driverId}
          onChange={setDriverId}
        />
        <DatePicker.RangePicker
          value={period}
          onChange={(value) => value && value[0] && value[1] && setPeriod([value[0], value[1]])}
        />
      </Space>

      {driverId && (
        <Space wrap style={{ marginBottom: 16 }}>
          <Button size="small" onClick={selectToday}>
            选择今天
          </Button>
          <Button size="small" onClick={selectYesterday}>
            选择昨天
          </Button>
          <Button size="small" onClick={selectThisWeek}>
            选择本周
          </Button>
          <Button size="small" onClick={selectAllUnsettled} disabled={!earliestUnsettled}>
            选择全部待结算
          </Button>
        </Space>
      )}

      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        日期范围只是筛选/发现工具：下面列出这个范围内可以结算的项目，勾选你要现在结算的项目再按
        Confirm，没勾的项目留到下次。Wallet 依据 Effective Date；Collection 依据 Collected At。
      </Typography.Text>

      {driverId && (
        <Card loading={isFetching} title="Settlement Summary">
          {preview && (
            <>
              {/* A. Settlement Summary Card：依「目前勾选」即时重算，手机版 Descriptions
                  自动切成单栏。 */}
              <Descriptions column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }} bordered size="small">
                <Descriptions.Item label="Driver">{preview.driver.name}</Descriptions.Item>
                <Descriptions.Item label="已选 / 可选">
                  {selectedCount} / {availableCount} 笔
                </Descriptions.Item>
                <Descriptions.Item label="Driver Earnings (Wallet，已选)">
                  {formatCents(selectionSummary?.walletAmountCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Driver Collected Amount（代收款，已选）">
                  {formatCents(selectionSummary?.collectionAmountCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Positive Adjustments">
                  {formatCents(selectionSummary?.positiveAdjustmentsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Negative Adjustments">
                  {formatCents(selectionSummary?.negativeAdjustmentsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Net Settlement">{formatCents(netAmountCents)}</Descriptions.Item>
              </Descriptions>

              {/* B. Settlement Result：正负净额三种结果，独立于上面的明细，一眼就看到结论。 */}
              <Alert
                type={settlementResult.type}
                showIcon
                message={<Typography.Text strong>{settlementResult.message}</Typography.Text>}
                style={{ marginBottom: 16 }}
              />

              {hasNothingAvailable ? (
                <Card size="small" style={{ marginBottom: 16 }}>
                  <Typography.Paragraph strong style={{ marginBottom: 8 }}>
                    你选择的日期范围内没有可结算收入。
                  </Typography.Paragraph>
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="当前选择范围">
                      {periodStart} ~ {periodEnd}
                    </Descriptions.Item>
                    <Descriptions.Item label="周期内可结算">{availableCount} 笔</Descriptions.Item>
                    <Descriptions.Item label="周期外待结算">{excludedCount} 笔</Descriptions.Item>
                    {earliestUnsettled && (
                      <Descriptions.Item label="最早未结算日期">{earliestUnsettled.format("YYYY-MM-DD")}</Descriptions.Item>
                    )}
                    {latestUnsettled && (
                      <Descriptions.Item label="最晚未结算日期">{latestUnsettled.format("YYYY-MM-DD")}</Descriptions.Item>
                    )}
                  </Descriptions>
                  {excludedCount > 0 && (
                    <Button type="primary" style={{ marginTop: 12 }} onClick={selectAllUnsettled}>
                      自动选择全部未结算日期
                    </Button>
                  )}
                </Card>
              ) : (
                <>
                  <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                    周期内可结算：{availableCount} 笔{excludedCount > 0 ? ` · 周期外待结算：${excludedCount} 笔` : ""}
                  </Typography.Text>
                  {/* C. Available Wallet Transactions/Collections：Checkbox + Card，手机/桌面
                      共用同一份排版，选完即时重算上面的 Summary。 */}
                  {preview.transactions.length > 0 && (
                    <>
                      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                        Available Wallet Transactions
                      </Typography.Text>
                      <SelectableWalletCards
                        items={preview.transactions}
                        selectedIds={selectedTxIds}
                        onToggle={toggleTx}
                        onSelectAll={() => setSelectedTxIds(new Set(preview.transactions.map((tx) => tx.id)))}
                        onDeselectAll={() => setSelectedTxIds(new Set())}
                      />
                    </>
                  )}
                  {preview.collections.length > 0 && (
                    <>
                      <Typography.Text strong style={{ marginTop: 16, display: "block", marginBottom: 8 }}>
                        Available Collections
                      </Typography.Text>
                      <SelectableCollectionCards
                        items={preview.collections}
                        selectedIds={selectedCollectionIds}
                        onToggle={toggleCollection}
                        onSelectAll={() => setSelectedCollectionIds(new Set(preview.collections.map((c) => c.id)))}
                        onDeselectAll={() => setSelectedCollectionIds(new Set())}
                      />
                    </>
                  )}
                </>
              )}

              {/* D. Excluded Transactions/Collections：每笔用 Card，明确显示排除原因，不能勾选——
                  日期范围只是筛选工具，落在范围外的项目要先调整范围才能纳入（v1 限制），不能
                  直接跨范围手动选。 */}
              {preview.excludedTransactions.length > 0 && (
                <>
                  <Typography.Text strong style={{ marginTop: 16, display: "block", marginBottom: 8 }}>
                    Excluded Wallet Transactions（{preview.excludedTransactions.length} 笔）
                  </Typography.Text>
                  <ExcludedWalletCards items={preview.excludedTransactions} periodStart={periodStart} periodEnd={periodEnd} />
                </>
              )}

              {preview.excludedCollections.length > 0 && (
                <>
                  <Typography.Text strong style={{ marginTop: 16, display: "block", marginBottom: 8 }}>
                    Excluded Collections（{preview.excludedCollections.length} 笔）
                  </Typography.Text>
                  <ExcludedCollectionCards items={preview.excludedCollections} periodStart={periodStart} periodEnd={periodEnd} />
                </>
              )}

              <PermissionGate permission={PERMISSIONS.SETTLEMENT_WRITE}>
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 16, minHeight: 44 }}
                  disabled={hasNothingSelected}
                  loading={confirmSettlement.isPending}
                  onClick={handleConfirm}
                >
                  Confirm Settlement（结算已选的 {selectedCount} 笔）
                </Button>
              </PermissionGate>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
