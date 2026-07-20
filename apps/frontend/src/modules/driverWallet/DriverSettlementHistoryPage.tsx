import { Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMySettlementsQuery } from "../settlement/hooks";
import { formatCents } from "../../lib/money";
import type { Settlement, SettlementStatus } from "../settlement/types";

const STATUS_COLOR: Record<SettlementStatus, string> = {
  DRAFT: "default",
  COMPLETED: "success",
  VOIDED: "error"
};

export function DriverSettlementHistoryPage() {
  const { data, isLoading } = useMySettlementsQuery();

  const columns: ColumnsType<Settlement> = [
    { title: "Reference", dataIndex: "reference" },
    { title: "Settlement Date", dataIndex: "settlementDate", render: (v: string) => new Date(v).toLocaleDateString() },
    { title: "Net Amount", dataIndex: "netAmountCents", render: (v: number) => formatCents(v) },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: SettlementStatus) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>
    },
    { title: "Created At", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>Settlement History</Typography.Title>
      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />
    </div>
  );
}
