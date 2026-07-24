import { Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { WalletTransaction, WalletTransactionStatus } from "../types";
import { formatCents } from "../../../lib/money";
import { useIsMobile } from "../../../common/useIsMobile";
import { MobileCardList } from "../../../common/MobileCardList";

const STATUS_COLOR: Record<WalletTransactionStatus, string> = {
  PENDING: "gold",
  SETTLED: "success",
  VOIDED: "default"
};

const STATUS_LABEL: Record<WalletTransactionStatus, string> = {
  PENDING: "待结算",
  SETTLED: "已结算",
  VOIDED: "已作废"
};

export const TYPE_LABEL: Record<WalletTransaction["transactionType"], string> = {
  LEG_EARNING: "Leg Earning",
  MANUAL_ADJUSTMENT: "Manual Adjustment",
  SETTLEMENT_ADJUSTMENT: "Settlement Adjustment",
  EXPENSE_REIMBURSEMENT: "Expense Reimbursement",
  REVENUE_SHARE_PAYOUT: "Revenue Share Payout"
};

export function WalletTransactionTable({
  data,
  loading,
  showDriverColumn = false,
  pagination
}: {
  data: WalletTransaction[] | undefined;
  loading: boolean;
  showDriverColumn?: boolean;
  pagination?: false | { current: number; pageSize: number; total: number; onChange: (page: number) => void };
}) {
  const isMobile = useIsMobile();
  const columns: ColumnsType<WalletTransaction> = [
    ...(showDriverColumn
      ? [{ title: "Driver", render: (_: unknown, record: WalletTransaction) => record.driver?.name ?? "-" }]
      : []),
    { title: "Booking", render: (_, record) => (record.booking ? `#${record.booking.id} ${record.booking.girlName}` : "-") },
    { title: "Leg", render: (_, record) => (record.leg ? `Leg ${record.leg.sequence}` : "-") },
    { title: "Type", dataIndex: "transactionType", render: (v: WalletTransaction["transactionType"]) => TYPE_LABEL[v] },
    { title: "Amount", dataIndex: "amountCents", render: (v: number) => formatCents(v) },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: WalletTransactionStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
    },
    { title: "Effective Date", dataIndex: "effectiveDate", render: (v: string) => new Date(v).toLocaleDateString() },
    { title: "Created Time", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
    { title: "Settlement Reference", render: (_, record) => record.settlement?.reference ?? "-" },
    { title: "Description", dataIndex: "description", render: (v: string | null) => v ?? "-" }
  ];

  if (isMobile) {
    return (
      <MobileCardList
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={pagination === false ? undefined : pagination}
        emptyText="没有交易纪录"
      />
    );
  }

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={data}
      columns={columns}
      pagination={pagination === false ? false : pagination}
    />
  );
}
