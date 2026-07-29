import { useState } from "react";
import { Empty, Pagination, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useMyTransactionsQuery } from "../wallet/hooks";
import type { WalletTransaction, WalletTransactionStatus } from "../wallet/types";
import { formatCents } from "../../lib/money";
import { useIsMobile } from "../../common/useIsMobile";
import { MobileCardList } from "../../common/MobileCardList";
import { ResponsiveModal } from "../../common/ResponsiveModal";

/**
 * Driver Wallet Transaction History（standalone feature，2026-07）：Driver 自己完整的
 * 收入纪录列表——刻意不是 GPS/Dispatch/Settlement 的一部分，也不重用 Admin 端的
 * WalletTransactionTable（那个表格是给 Admin 看 Type/Effective Date/Settlement
 * Reference 这些管理欄位，跟这里「Driver 只要看得懂自己赚了多少、哪一趟、什么时候」
 * 的需求不一样）。资料完全重用既有的 useMyTransactionsQuery/fetchMyTransactions
 * （跟 My Earnings 页面同一支 API），不新增任何记账逻辑，纯粹是另一种呈现方式。
 */

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

function formatSignedAmount(cents: number) {
  const sign = cents < 0 ? "-" : "+";
  return `${sign}${formatCents(Math.abs(cents))}`;
}

function formatDateTime(value: string | null) {
  return value ? dayjs(value).format("YYYY-MM-DD (ddd) HH:mm") : "-";
}

/**
 * Driver 没有 booking:read 权限、也进不了 Admin Portal 的 /bookings/:id，所以「点开相关
 * Booking」不是导去那个页面，而是直接用这笔 Transaction 本来就已经带出来的 Booking/Leg
 * 资料（Pickup/Destination/完成时间/金额/状态）做成一个唯读的详情弹窗——不用另外呼叫任何
 * API，也完全不碰 Booking 模块本身，符合「只读、不建新功能」的范围。
 */
function BookingDetailModal({ transaction, onClose }: { transaction: WalletTransaction | null; onClose: () => void }) {
  return (
    <ResponsiveModal title="Booking 详情" open={transaction !== null} onCancel={onClose} cancelText="关闭">
      {transaction && (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text strong>
            Booking #{transaction.booking?.id ?? "-"} {transaction.booking?.girlName ?? ""}
          </Typography.Text>
          <Typography.Text>Pickup：{transaction.leg?.pickupLocation ?? "-"}</Typography.Text>
          <Typography.Text>Destination：{transaction.leg?.dropoffLocation ?? "-"}</Typography.Text>
          <Typography.Text>完成时间：{formatDateTime(transaction.leg?.completedAt ?? null)}</Typography.Text>
          <Typography.Text>金额：{formatSignedAmount(transaction.amountCents)}</Typography.Text>
          <Space size={4}>
            <Typography.Text>状态：</Typography.Text>
            <Tag color={STATUS_COLOR[transaction.status]}>{STATUS_LABEL[transaction.status]}</Tag>
          </Space>
        </Space>
      )}
    </ResponsiveModal>
  );
}

export function WalletHistoryPage() {
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();
  const pageSize = 20;

  const { data, isLoading } = useMyTransactionsQuery({ page, pageSize });
  const [selected, setSelected] = useState<WalletTransaction | null>(null);

  const columns: ColumnsType<WalletTransaction> = [
    {
      title: "Amount",
      dataIndex: "amountCents",
      render: (v: number) => (
        <Typography.Text strong type={v < 0 ? "danger" : "success"}>
          {formatSignedAmount(v)}
        </Typography.Text>
      )
    },
    { title: "Booking ID", render: (_, record) => (record.booking ? `#${record.booking.id}` : "-") },
    { title: "Pickup Location", render: (_, record) => record.leg?.pickupLocation ?? "-" },
    { title: "Destination", render: (_, record) => record.leg?.dropoffLocation ?? "-" },
    { title: "Completed Date & Time", render: (_, record) => formatDateTime(record.leg?.completedAt ?? null) },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: WalletTransactionStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
    }
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>Wallet History</Typography.Title>
      <Typography.Paragraph type="secondary">点一笔纪录可以看这趟行程的 Booking 详情。</Typography.Paragraph>

      {isMobile ? (
        <MobileCardList
          rowKey="id"
          loading={isLoading}
          dataSource={data?.data}
          columns={columns}
          onRowClick={setSelected}
          pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
          emptyText="还没有任何收入纪录"
        />
      ) : !isLoading && (!data || data.data.length === 0) ? (
        <Empty description="还没有任何收入纪录" />
      ) : (
        <>
          <Table
            rowKey="id"
            loading={isLoading}
            dataSource={data?.data}
            columns={columns}
            pagination={false}
            onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: "pointer" } })}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Pagination current={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
          </div>
        </>
      )}

      <BookingDetailModal transaction={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
