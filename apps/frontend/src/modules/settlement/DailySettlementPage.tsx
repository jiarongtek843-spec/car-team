import { useState } from "react";
import { Alert, Button, Card, DatePicker, Descriptions, Select, Space, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useDriversQuery } from "../drivers/hooks";
import { useConfirmSettlementMutation, useSettlementPreviewQuery } from "./hooks";
import { WalletTransactionTable } from "../wallet/components/WalletTransactionTable";
import { formatCents } from "../../lib/money";

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

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>Daily Settlement</Typography.Title>

      <Space style={{ marginBottom: 16 }}>
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
        <Card loading={isFetching} title="Settlement Preview">
          {preview && (
            <>
              <Descriptions column={2} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Driver">{preview.driver.name}</Descriptions.Item>
                <Descriptions.Item label="Net Settlement Amount">
                  <Typography.Text strong>{formatCents(preview.netAmountCents)}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Period Start">
                  {new Date(preview.periodStart).toLocaleDateString()}
                </Descriptions.Item>
                <Descriptions.Item label="Period End">
                  {new Date(preview.periodEnd).toLocaleDateString()}
                </Descriptions.Item>
                <Descriptions.Item label="Completed Leg Earnings">
                  {formatCents(preview.completedLegEarningsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Positive Adjustments">
                  {formatCents(preview.positiveAdjustmentsCents)}
                </Descriptions.Item>
                <Descriptions.Item label="Negative Adjustments" span={2}>
                  {formatCents(preview.negativeAdjustmentsCents)}
                </Descriptions.Item>
              </Descriptions>

              {preview.transactions.length === 0 ? (
                <Alert type="info" message="这个周期内没有可结算的项目" showIcon style={{ marginBottom: 16 }} />
              ) : (
                <>
                  <Typography.Text strong>Included Transactions</Typography.Text>
                  <WalletTransactionTable data={preview.transactions} loading={false} pagination={false} />
                </>
              )}

              {preview.excludedTransactions.length > 0 && (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 16, marginBottom: 8 }}
                    message={`这个 Driver 还有 ${preview.excludedTransactions.length} 笔待结算项目落在这个周期之外，不会被这次日结纳入`}
                  />
                  <Typography.Text strong>Excluded Transactions</Typography.Text>
                  <WalletTransactionTable data={preview.excludedTransactions} loading={false} pagination={false} />
                </>
              )}

              <Button
                type="primary"
                style={{ marginTop: 16 }}
                disabled={preview.transactions.length === 0}
                loading={confirmSettlement.isPending}
                onClick={handleConfirm}
              >
                Confirm Settlement
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
