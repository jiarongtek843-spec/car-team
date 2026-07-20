import { useState } from "react";
import { Card, Empty, Input, List, Segmented, Space, Tag, Typography } from "antd";
import { useWaitingBookingsQuery } from "../hooks";
import { PRIORITY_COLOR, PRIORITY_LABELS } from "../types";
import type { BookingDispatchFilter, DispatchWaitingLeg } from "../types";
import { LegStatusTag } from "../../bookings/components/StatusTags";

const FILTER_OPTIONS: { label: string; value: BookingDispatchFilter | "ALL" }[] = [
  { label: "全部", value: "ALL" },
  { label: "Waiting", value: "WAITING" },
  { label: "Assigned", value: "ASSIGNED" },
  { label: "Accepted", value: "ACCEPTED" },
  { label: "In Progress", value: "IN_PROGRESS" }
];

export function WaitingBookingsPanel({
  selectedLegId,
  onSelectLeg
}: {
  selectedLegId: number | null;
  onSelectLeg: (leg: DispatchWaitingLeg) => void;
}) {
  const [filter, setFilter] = useState<BookingDispatchFilter | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useWaitingBookingsQuery(filter === "ALL" ? undefined : filter, search);

  return (
    <Card title="Waiting Booking" extra={<Typography.Text type="secondary">{data?.length ?? 0} 笔</Typography.Text>}>
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
        <Segmented
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(v) => setFilter(v as BookingDispatchFilter | "ALL")}
        />
        <Input.Search allowClear placeholder="搜索 Booking ID / Girl 姓名" onSearch={setSearch} />
      </Space>

      {!isLoading && (!data || data.length === 0) ? (
        <Empty description="没有符合条件的 Booking" />
      ) : (
        <List
          loading={isLoading}
          dataSource={data}
          style={{ maxHeight: 600, overflowY: "auto" }}
          renderItem={(leg) => (
            <List.Item
              onClick={() => onSelectLeg(leg)}
              style={{
                cursor: "pointer",
                padding: 12,
                background: selectedLegId === leg.legId ? "#e6f4ff" : undefined,
                borderRadius: 4
              }}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text strong>
                      #{leg.bookingId} {leg.girlName} · Leg {leg.sequence}
                    </Typography.Text>
                    <LegStatusTag status={leg.status} />
                    <Tag color={PRIORITY_COLOR[leg.priority]}>{PRIORITY_LABELS[leg.priority]}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Typography.Text>
                      {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {leg.scheduledAt ? new Date(leg.scheduledAt).toLocaleString() : "未设定时间"}
                      {leg.driver && ` · 目前：${leg.driver.name}`}
                    </Typography.Text>
                    {leg.status === "REJECTED" && leg.rejectionReason && (
                      <Typography.Text type="danger">拒绝原因：{leg.rejectionReason}</Typography.Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
