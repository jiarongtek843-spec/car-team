import { useMemo, useState } from "react";
import { Alert, Button, Card, DatePicker, Descriptions, Select, Space, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useDriversQuery } from "../drivers/hooks";
import { useConfirmSettlementMutation, useSettlementPreviewQuery } from "./hooks";
import { WalletTransactionTable, TYPE_LABEL } from "../wallet/components/WalletTransactionTable";
import { CollectionTable } from "../collections/components/CollectionTable";
import { PURPOSE_LABELS } from "../collections/types";
import type { WalletTransaction } from "../wallet/types";
import type { Collection } from "../collections/types";
import { formatCents } from "../../lib/money";
import { PermissionGate } from "../auth/PermissionGate";
import { PERMISSIONS } from "../../common/permissions";

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
            <Typography.Text type="warning">
              排除原因：{c.collectedAt ? excludedReason(c.collectedAt, periodStart, periodEnd) : "—"}
            </Typography.Text>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

export function DailySettlementPage() {
  const [driverId, setDriverId] = useState<number | undefined>(undefined);
  const [period, setPeriod] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);

  const { data: drivers } = useDriversQuery();
  const periodStart = period[0].format("YYYY-MM-DD");
  const periodEnd = period[1].format("YYYY-MM-DD");
  const { data: preview, isFetching } = useSettlementPreviewQuery(driverId, periodStart, periodEnd);
  const confirmSettlement = useConfirmSettlementMutation();

  async function handleConfirm() {
    if (!driverId) return;
    const settlement = await confirmSettlement.mutateAsync({ driverId, periodStart, periodEnd });
    message.success(`日结完成，Reference: ${settlement.reference}`);
  }

  const includedCount = (preview?.transactions.length ?? 0) + (preview?.collections.length ?? 0);
  const excludedCount = (preview?.excludedTransactions.length ?? 0) + (preview?.excludedCollections.length ?? 0);
  const hasNothingToSettle = includedCount === 0;

  // preview 同时回传「周期内」跟「周期外」的项目，两者合起来就是这个 Driver 目前全部
  // PENDING/VERIFIED 的待结算资料——不管当前选的周期是什么，都能从这份资料算出
  // 「最早/最晚未结算日期」，不需要另外呼叫 API。
  const { earliestUnsettled, latestUnsettled } = useMemo(() => {
    if (!preview) return { earliestUnsettled: null as Dayjs | null, latestUnsettled: null as Dayjs | null };
    const txDates = [...preview.transactions, ...preview.excludedTransactions].map((t) => dayjs(t.effectiveDate));
    const colDates = [...preview.collections, ...preview.excludedCollections]
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

  const netAmountCents = preview?.netAmountCents ?? 0;
  const settlementResult =
    !preview || hasNothingToSettle || netAmountCents === 0
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
        日结依据两个独立的时间点计算：Wallet 收入依据 Effective Date（收入生效日）；Collection 代收款依据 Collected
        At（代收时间）。
      </Typography.Text>

      {driverId && (
        <Card loading={isFetching} title="Settlement Summary">
          {preview && (
            <>
              {/* A. Settlement Summary Card：手机版 Descriptions 自动切成单栏，字不会被挤成一字一行。 */}
              <Descriptions column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }} bordered size="small">
                <Descriptions.Item label="Driver">{preview.driver.name}</Descriptions.Item>
                <Descriptions.Item label="Period Start">
                  {new Date(preview.periodStart).toLocaleDateString()}
                </Descriptions.Item>
                <Descriptions.Item label="Period End">{new Date(preview.periodEnd).toLocaleDateString()}</Descriptions.Item>
                <Descriptions.Item label="Driver Earnings (Wallet)">{formatCents(preview.walletAmountCents)}</Descriptions.Item>
                <Descriptions.Item label="Driver Collected Amount（代收款）">
                  {formatCents(preview.collectionAmountCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Positive Adjustments">
                  {formatCents(preview.positiveAdjustmentsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Negative Adjustments">
                  {formatCents(preview.negativeAdjustmentsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Net Settlement">{formatCents(preview.netAmountCents)}</Descriptions.Item>
              </Descriptions>

              {/* B. Settlement Result：正负净额三种结果，独立于上面的明细，一眼就看到结论。 */}
              <Alert
                type={settlementResult.type}
                showIcon
                message={<Typography.Text strong>{settlementResult.message}</Typography.Text>}
                style={{ marginBottom: 16 }}
              />

              {hasNothingToSettle ? (
                <Card size="small" style={{ marginBottom: 16 }}>
                  <Typography.Paragraph strong style={{ marginBottom: 8 }}>
                    你选择的日期范围内没有可结算收入。
                  </Typography.Paragraph>
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="当前选择范围">
                      {periodStart} ~ {periodEnd}
                    </Descriptions.Item>
                    <Descriptions.Item label="周期内可结算">{includedCount} 笔</Descriptions.Item>
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
                    周期内可结算：{includedCount} 笔{excludedCount > 0 ? ` · 周期外待结算：${excludedCount} 笔` : ""}
                  </Typography.Text>
                  {/* C. Included Transactions/Collections：WalletTransactionTable/CollectionTable
                      本身已经支援手机 Card 化，不需要在这里再写一份手机专用排版。 */}
                  {preview.transactions.length > 0 && (
                    <>
                      <Typography.Text strong>Included Wallet Transactions</Typography.Text>
                      <WalletTransactionTable data={preview.transactions} loading={false} pagination={false} />
                    </>
                  )}
                  {preview.collections.length > 0 && (
                    <>
                      <Typography.Text strong style={{ marginTop: 16, display: "block" }}>
                        Included Collections
                      </Typography.Text>
                      <CollectionTable data={preview.collections} loading={false} pagination={false} />
                    </>
                  )}
                </>
              )}

              {/* D. Excluded Transactions/Collections：每笔用 Card，明确显示排除原因，
                  不用 WalletTransactionTable/CollectionTable（那两个共用组件没有「排除原因」
                  这个概念，其他呼叫端也用不到）。 */}
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
                  style={{ marginTop: 16 }}
                  disabled={hasNothingToSettle}
                  loading={confirmSettlement.isPending}
                  onClick={handleConfirm}
                >
                  Confirm Settlement
                </Button>
              </PermissionGate>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
