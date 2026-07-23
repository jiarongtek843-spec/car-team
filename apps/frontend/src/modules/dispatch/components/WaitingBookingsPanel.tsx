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
  onSelectLeg,
  defaultFilter = "ALL",
  title = "Waiting Booking"
}: {
  selectedLegId: number | null;
  onSelectLeg: (leg: DispatchWaitingLeg) => void;
  /** Dispatch Center 手机版的「Active Jobs」Tab 复用同一个 Panel，只是预设 Filter 不同
   * （IN_PROGRESS），不需要重新实作一个几乎一样的列表组件或新增 Backend API。 */
  defaultFilter?: BookingDispatchFilter | "ALL";
  title?: string;
}) {
  const [filter, setFilter] = useState<BookingDispatchFilter | "ALL">(defaultFilter);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useWaitingBookingsQuery(filter === "ALL" ? undefined : filter, search);

  return (
    <Card title={title} extra={<Typography.Text type="secondary">{data?.length ?? 0} 笔</Typography.Text>}>
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
        {/* Segmented 本身不会自动换行，选项一多手机上可能比容器宽——用一个可以局部横向
            卷动的容器包住，卷动只发生在这个小控件内，不会影响整个页面（页面本身
            禁止横向卷动，见 index.css）。 */}
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <Segmented
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(v) => setFilter(v as BookingDispatchFilter | "ALL")}
          />
        </div>
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
