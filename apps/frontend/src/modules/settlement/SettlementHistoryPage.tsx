import { useState } from "react";
import { Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useDriversQuery } from "../drivers/hooks";
import { useSettlementsQuery } from "./hooks";
import { VoidSettlementModal } from "./components/VoidSettlementModal";
import { CreateAdjustmentModal } from "../wallet/components/CreateAdjustmentModal";
import { formatCents } from "../../lib/money";
import { formatDateSafe, formatDateTimeSafe } from "../../lib/formatDate";
import { useIsMobile } from "../../common/useIsMobile";
import { MobileCardList } from "../../common/MobileCardList";
import { ResponsiveFilterBar } from "../../common/ResponsiveFilterBar";
import type { Settlement, SettlementStatus } from "./types";
import { PermissionGate } from "../auth/PermissionGate";
import { PERMISSIONS } from "../../common/permissions";

const STATUS_COLOR: Record<SettlementStatus, string> = {
  DRAFT: "default",
  COMPLETED: "success",
  VOIDED: "error"
};

export function SettlementHistoryPage() {
  const [driverId, setDriverId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [adjustingSettlement, setAdjustingSettlement] = useState<Settlement | null>(null);
  const pageSize = 20;
  const isMobile = useIsMobile();

  const { data: drivers } = useDriversQuery();
  const { data, isLoading } = useSettlementsQuery({ driverId, page, pageSize });

  const columns: ColumnsType<Settlement> = [
    { title: "Reference", dataIndex: "reference" },
    { title: "Driver", render: (_, record) => record.driver.name },
    {
      title: "Period",
      render: (_, record) => `${formatDateSafe(record.periodStart)} ~ ${formatDateSafe(record.periodEnd)}`
    },
    { title: "Wallet (Earnings)", dataIndex: "walletAmountCents", render: (v: number) => formatCents(v) },
    { title: "Collection", dataIndex: "collectionAmountCents", render: (v: number) => formatCents(v) },
    {
      title: "Net Amount",
      dataIndex: "netAmountCents",
      render: (v: number) => (
        <span style={{ color: v < 0 ? "#cf1322" : undefined }}>{v >= 0 ? formatCents(v) : `-${formatCents(-v)}`}</span>
      )
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: SettlementStatus) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>
    },
    { title: "Created At", dataIndex: "createdAt", render: (v: string | null) => formatDateTimeSafe(v) },
    {
      title: "操作",
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.SETTLEMENT_WRITE}>
          <Space>
            {record.status === "COMPLETED" && <a onClick={() => setVoidingId(record.id)}>Void</a>}
            <a onClick={() => setAdjustingSettlement(record)}>Settlement Adjustment</a>
          </Space>
        </PermissionGate>
      )
    }
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>Settlement History</Typography.Title>

      <ResponsiveFilterBar>
        <Select
          allowClear
          placeholder="筛选 Driver"
          style={{ width: isMobile ? "100%" : 200 }}
          options={drivers?.map((driver) => ({ label: driver.name, value: driver.id }))}
          value={driverId}
          onChange={(value) => {
            setDriverId(value);
            setPage(1);
          }}
        />
      </ResponsiveFilterBar>

      {isMobile ? (
        <MobileCardList
          rowKey="id"
          loading={isLoading}
          dataSource={data?.data}
          columns={columns}
          pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
          emptyText="没有结算纪录"
        />
      ) : (
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.data}
          columns={columns}
          pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
        />
      )}

      <VoidSettlementModal settlementId={voidingId} onClose={() => setVoidingId(null)} />
      <CreateAdjustmentModal
        open={adjustingSettlement !== null}
        onClose={() => setAdjustingSettlement(null)}
        type="SETTLEMENT_ADJUSTMENT"
        relatedSettlementId={adjustingSettlement?.id}
        defaultDriverId={adjustingSettlement?.driverId}
      />
    </div>
  );
}
