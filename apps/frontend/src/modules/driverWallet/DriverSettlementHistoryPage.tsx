import { Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMySettlementsQuery } from "../settlement/hooks";
import { formatCents } from "../../lib/money";
import { formatDateTimeSafe } from "../../lib/formatDate";
import { useIsMobile } from "../../common/useIsMobile";
import { MobileCardList } from "../../common/MobileCardList";
import type { Settlement, SettlementStatus } from "../settlement/types";

const STATUS_COLOR: Record<SettlementStatus, string> = {
  DRAFT: "default",
  COMPLETED: "success",
  VOIDED: "error"
};

export function DriverSettlementHistoryPage() {
  const { data, isLoading } = useMySettlementsQuery();
  const isMobile = useIsMobile();

  const columns: ColumnsType<Settlement> = [
    { title: "Reference", dataIndex: "reference" },
    // Bug Fix（Mobile UAT Round 3）：这里之前读的是根本不存在的 `settlementDate` 栏位，
    // `new Date(undefined)` 一定是 Invalid Date。Settlement 建立当下就是 COMPLETED
    // 状态（没有另外的「结算完成日」栏位），`createdAt` 才是真正的结算完成时间。
    { title: "Settlement Date", dataIndex: "createdAt", render: (v: string | null) => formatDateTimeSafe(v) },
    { title: "Net Amount", dataIndex: "netAmountCents", render: (v: number) => formatCents(v) },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: SettlementStatus) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>
    },
    { title: "Created At", dataIndex: "createdAt", render: (v: string | null) => formatDateTimeSafe(v) }
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>Settlement History</Typography.Title>
      {isMobile ? (
        <MobileCardList rowKey="id" loading={isLoading} dataSource={data} columns={columns} emptyText="没有结算纪录" />
      ) : (
        <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />
      )}
    </div>
  );
}
