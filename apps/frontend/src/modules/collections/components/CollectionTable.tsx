import { useState } from "react";
import { Image, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Collection, CollectionStatus } from "../types";
import { PAYMENT_METHOD_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../types";
import { formatCents } from "../../../lib/money";
import { useIsMobile } from "../../../common/useIsMobile";
import { MobileCardList } from "../../../common/MobileCardList";
import { toProofUrl } from "../../../lib/uploads";

const STATUS_COLOR: Record<CollectionStatus, string> = {
  PENDING: "default",
  COLLECTED: "gold",
  VERIFIED: "blue",
  SETTLED: "success",
  VOIDED: "error"
};

// 图片载入失败（档案已经不在磁盘上、或没有权限）时显示明确文字，不是破图或问号图标——
// 手机 UAT 明确要求「文件不存在时显示：证明图片已不存在，请重新上传」。用小组件包一层
// 是因为 error 状态要 per-image 记，不能整个 Table 共用一个布林值。
function ProofThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        证明图片已不存在，请重新上传
      </Typography.Text>
    );
  }

  // antd Image 点击缩图会自动打开全屏预览（内建 preview，不需要额外接线）。
  return <Image src={url} width={48} height={48} style={{ objectFit: "cover" }} onError={() => setFailed(true)} />;
}

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
      render: (v: string | null) => {
        const url = toProofUrl(v);
        return url ? <ProofThumbnail url={url} /> : "-";
      }
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
