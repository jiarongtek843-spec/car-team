import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Select, Space, Table, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useBookingsQuery } from "./hooks";
import { BookingStatusTag } from "./components/StatusTags";
import { CreateBookingModal } from "./components/CreateBookingModal";
import type { BookingListItem, BookingStatus } from "../../types/booking";
import { formatCents } from "../../lib/money";
import { useIsMobile } from "../../common/useIsMobile";
import { MobileCardList } from "../../common/MobileCardList";
import { ResponsiveFilterBar } from "../../common/ResponsiveFilterBar";

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
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<BookingStatus | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;

  function runSearch() {
    setSearch(searchInput.trim());
    setPage(1);
  }

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

  function goToBooking(record: BookingListItem) {
    navigate(`/bookings/${record.id}`);
  }

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Booking
        </Typography.Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 新建 Booking
        </Button>
      </Space>

      {/* 不用 Input.Search 内建的紧凑搜索按钮——那个按钮宽度固定，窄屏下会把输入框
          挤得很窄。改用独立的 Input + Button，ResponsiveFilterBar 负责手机版的
          排版（各占一行），这里不需要再自己写 isMobile 分支。 */}
      <ResponsiveFilterBar>
        <Select
          allowClear
          placeholder="筛选状态"
          style={{ width: 160, minWidth: 160 }}
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Input
          placeholder="搜索 Girl 姓名"
          style={{ width: 240, minWidth: 200 }}
          allowClear
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={runSearch}
        />
        <Button type="primary" icon={<SearchOutlined />} style={{ height: 44 }} onClick={runSearch}>
          搜索
        </Button>
      </ResponsiveFilterBar>

      {isMobile ? (
        <MobileCardList
          rowKey="id"
          loading={isLoading}
          dataSource={data?.data}
          columns={columns}
          onRowClick={goToBooking}
          pagination={{ current: page, pageSize, total: data?.total, onChange: setPage }}
          emptyText="没有符合条件的 Booking"
        />
      ) : (
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.data}
          columns={columns}
          onRow={(record) => ({
            onClick: () => goToBooking(record),
            style: { cursor: "pointer" }
          })}
          pagination={{
            current: page,
            pageSize,
            total: data?.total,
            onChange: setPage
          }}
        />
      )}

      <CreateBookingModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
