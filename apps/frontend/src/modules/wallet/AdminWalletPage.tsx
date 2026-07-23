import { useState } from "react";
import { Button, Card, DatePicker, Select, Space, Table, Typography } from "antd";
import dayjs from "dayjs";
import { useAdminTransactionsQuery, useUnsettledByDriverQuery } from "./hooks";
import { useDriversQuery } from "../drivers/hooks";
import { WalletTransactionTable } from "./components/WalletTransactionTable";
import { CreateAdjustmentModal } from "./components/CreateAdjustmentModal";
import { formatCents } from "../../lib/money";
import type { WalletTransactionStatus } from "./types";
import { PermissionGate } from "../auth/PermissionGate";
import { PERMISSIONS } from "../../common/permissions";
import { useIsMobile } from "../../common/useIsMobile";
import { MobileCardList } from "../../common/MobileCardList";

const STATUS_OPTIONS: { label: string; value: WalletTransactionStatus }[] = [
  { label: "待结算", value: "PENDING" },
  { label: "已结算", value: "SETTLED" },
  { label: "已作废", value: "VOIDED" }
];

export function AdminWalletPage() {
  const [driverId, setDriverId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<WalletTransactionStatus | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const isMobile = useIsMobile();
  const pageSize = 20;

  const { data: drivers } = useDriversQuery();
  const { data: unsettled } = useUnsettledByDriverQuery();
  const { data, isLoading } = useAdminTransactionsQuery({
    driverId,
    status,
    dateFrom: dateRange?.[0]?.toISOString(),
    dateTo: dateRange?.[1]?.toISOString(),
    page,
    pageSize
  });

  const unsettledColumns = [
    { title: "Driver", render: (_: unknown, record: NonNullable<typeof unsettled>[number]) => record.driver?.name ?? `#${record.driverId}` },
    { title: "Unsettled", dataIndex: "unsettledCents", render: (v: number) => formatCents(v) }
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Wallet
        </Typography.Title>
        <PermissionGate permission={PERMISSIONS.WALLET_WRITE}>
          <Button type="primary" onClick={() => setAdjustmentOpen(true)}>
            + 新增 Manual Adjustment
          </Button>
        </PermissionGate>
      </Space>

      <Card title="Unsettled Earnings by Driver" style={{ marginBottom: 16 }}>
        {isMobile ? (
          <MobileCardList rowKey="driverId" dataSource={unsettled} columns={unsettledColumns} emptyText="没有待结算金额" />
        ) : (
          <Table rowKey="driverId" size="small" dataSource={unsettled} pagination={false} columns={unsettledColumns} />
        )}
      </Card>

      <Space style={{ marginBottom: 16, width: "100%" }} wrap>
        <Select
          allowClear
          placeholder="筛选 Driver"
          style={{ width: isMobile ? "100%" : 180, minWidth: 160 }}
          options={drivers?.map((driver) => ({ label: driver.name, value: driver.id }))}
          value={driverId}
          onChange={(value) => {
            setDriverId(value);
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder="筛选状态"
          style={{ width: isMobile ? "100%" : 160, minWidth: 160 }}
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <DatePicker.RangePicker
          value={dateRange}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(range) => {
            setDateRange(range as [dayjs.Dayjs, dayjs.Dayjs] | null);
            setPage(1);
          }}
        />
      </Space>

      <WalletTransactionTable
        data={data?.data}
        loading={isLoading}
        showDriverColumn
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
      />

      <CreateAdjustmentModal open={adjustmentOpen} onClose={() => setAdjustmentOpen(false)} />
    </div>
  );
}
