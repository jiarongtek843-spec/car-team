import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Select, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useBookingsQuery } from "./hooks";
import { BookingStatusTag } from "./components/StatusTags";
import { CreateBookingModal } from "./components/CreateBookingModal";
import type { BookingListItem, BookingStatus } from "../../types/booking";
import { formatCents } from "../../lib/money";

const STATUS_OPTIONS: { label: string; value: BookingStatus }[] = [
  { label: "待处理", value: "PENDING" },
  { label: "进行中", value: "IN_PROGRESS" },
  { label: "已完成", value: "COMPLETED" },
  { label: "已取消", value: "CANCELLED" }
];

function legProgress(booking: BookingListItem) {
  const active = booking.legs.filter((leg) => leg.status !== "CANCELLED");
  const completed = active.filter((leg) => leg.status === "COMPLETED").length;
  return `${completed}/${active.length}`;
}

export function BookingListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<BookingStatus | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;

  const { data, isLoading } = useBookingsQuery({ status, search: search || undefined, page, pageSize });

  const columns: ColumnsType<BookingListItem> = [
    { title: "编号", dataIndex: "id", width: 80 },
    { title: "Girl", dataIndex: "girlName" },
    {
      title: "状态",
      dataIndex: "status",
      render: (value: BookingStatus) => <BookingStatusTag status={value} />
    },
    { title: "行程进度", render: (_, record) => legProgress(record) },
    { title: "Booking Total", dataIndex: "totalAmountCents", render: (value: number) => formatCents(value) },
    {
      title: "建立时间",
      dataIndex: "createdAt",
      render: (value: string) => new Date(value).toLocaleString()
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Booking
          </Typography.Title>
        </Space>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 新建 Booking
        </Button>
      </Space>

      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="筛选状态"
          style={{ width: 160 }}
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Input.Search
          placeholder="搜索 Girl 姓名"
          style={{ width: 240 }}
          allowClear
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.data}
        columns={columns}
        onRow={(record) => ({
          onClick: () => navigate(`/bookings/${record.id}`),
          style: { cursor: "pointer" }
        })}
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          onChange: setPage
        }}
      />

      <CreateBookingModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
