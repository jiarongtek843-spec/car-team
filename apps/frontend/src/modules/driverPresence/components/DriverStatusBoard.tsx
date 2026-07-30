import { Card, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useDriverPresenceQuery } from "../hooks";
import { PRESENCE_STATE_COLOR, PRESENCE_STATE_LABELS } from "../types";
import type { DriverPresenceEntry } from "../types";
import { useIsMobile } from "../../../common/useIsMobile";
import { MobileCardList } from "../../../common/MobileCardList";

function formatLastSeen(value: string | null) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "从未上线";
}

export function DriverStatusBoard() {
  const { data, isLoading } = useDriverPresenceQuery();
  const isMobile = useIsMobile();

  const columns: ColumnsType<DriverPresenceEntry> = [
    { title: "Driver Name", dataIndex: "driverName" },
    {
      title: "Current Status",
      dataIndex: "status",
      render: (status: DriverPresenceEntry["status"]) => (
        <Tag color={PRESENCE_STATE_COLOR[status]}>{PRESENCE_STATE_LABELS[status]}</Tag>
      )
    },
    {
      title: "Current Booking",
      render: (_, record) =>
        record.currentBooking ? (
          <span>
            #{record.currentBooking.id} {record.currentBooking.girlName}
          </span>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        )
    },
    {
      title: "Last Seen",
      dataIndex: "lastSeenAt",
      render: (value: string | null) => formatLastSeen(value)
    }
  ];

  return (
    <Card title="Driver Status" style={{ marginTop: 16 }}>
      {isMobile ? (
        <MobileCardList
          dataSource={data}
          columns={columns}
          rowKey="driverId"
          loading={isLoading}
          emptyText="还没有任何司机"
        />
      ) : (
        <Table
          dataSource={data}
          columns={columns}
          rowKey="driverId"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      )}
    </Card>
  );
}
