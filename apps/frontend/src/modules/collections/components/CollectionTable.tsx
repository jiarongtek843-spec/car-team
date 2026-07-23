import { Image, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Collection, CollectionStatus } from "../types";
import { PAYMENT_METHOD_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../types";
import { formatCents } from "../../../lib/money";
import { useIsMobile } from "../../../common/useIsMobile";
import { MobileCardList } from "../../../common/MobileCardList";

const STATUS_COLOR: Record<CollectionStatus, string> = {
  PENDING: "default",
  COLLECTED: "gold",
  VERIFIED: "blue",
  SETTLED: "success",
  VOIDED: "error"
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function CollectionTable({
  data,
  loading,
  showDriverColumn = false,
  actions,
  pagination
}: {
  data: Collection[] | undefined;
  loading: boolean;
  showDriverColumn?: boolean;
  actions?: (record: Collection) => React.ReactNode;
  pagination?: false | { current: number; pageSize: number; total: number; onChange: (page: number) => void };
}) {
  const isMobile = useIsMobile();
  const columns: ColumnsType<Collection> = [
    ...(showDriverColumn
      ? [{ title: "Driver", render: (_: unknown, record: Collection) => record.driver?.name ?? "-" }]
      : []),
    { title: "Booking", render: (_, record) => (record.booking ? `#${record.booking.id} ${record.booking.girlName}` : "-") },
    { title: "Leg", render: (_, record) => (record.leg ? `Leg ${record.leg.sequence}` : "-") },
    { title: "Customer", dataIndex: "customerName", render: (v: string | null) => v ?? "-" },
    { title: "Purpose", dataIndex: "purpose", render: (v: Collection["purpose"]) => PURPOSE_LABELS[v] },
    { title: "Amount", dataIndex: "amountCents", render: (v: number) => formatCents(v) },
    {
      title: "Payment Method",
      dataIndex: "paymentMethod",
      render: (v: Collection["paymentMethod"]) => PAYMENT_METHOD_LABELS[v]
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: CollectionStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABELS[v]}</Tag>
    },
    { title: "Collected Time", dataIndex: "collectedAt", render: (v: string | null) => (v ? new Date(v).toLocaleString() : "-") },
    {
      title: "Proof",
      dataIndex: "proofImageUrl",
      render: (v: string | null) =>
        v ? <Image src={`${API_BASE_URL}${v}`} width={48} height={48} style={{ objectFit: "cover" }} /> : "-"
    },
    { title: "Settlement Reference", render: (_, record) => record.settlement?.reference ?? "-" },
    { title: "Remark", dataIndex: "remark", render: (v: string | null) => v ?? "-" },
    ...(actions ? [{ title: "操作", render: (_: unknown, record: Collection) => actions(record) }] : [])
  ];

  if (isMobile) {
    return (
      <MobileCardList
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={pagination === false ? undefined : pagination}
        emptyText="没有代收款纪录"
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
      scroll={{ x: "max-content" }}
    />
  );
}
