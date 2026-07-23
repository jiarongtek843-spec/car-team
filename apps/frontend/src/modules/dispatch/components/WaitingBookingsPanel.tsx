import { useState } from "react";
import { Button, Card, DatePicker, Empty, Input, List, Segmented, Space, Tag, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useWaitingBookingsQuery } from "../hooks";
import { PRIORITY_COLOR, PRIORITY_LABELS } from "../types";
import type { BookingDispatchFilter, DispatchWaitingLeg } from "../types";
import { LegStatusTag, LegTypeTag } from "../../bookings/components/StatusTags";
import { formatLegDateTime } from "../../../lib/schedule";
import { ResponsiveFilterBar } from "../../../common/ResponsiveFilterBar";

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
  /** Dispatch Center 手机版的「Active Jobs」/「Completed」Tab 复用同一个 Panel，只是预设
   * Filter 不同，不需要重新实作一个几乎一样的列表组件或新增 Backend API。 */
  defaultFilter?: BookingDispatchFilter | "ALL";
  title?: string;
}) {
  const isCompletedView = defaultFilter === "COMPLETED";
  const [filter, setFilter] = useState<BookingDispatchFilter | "ALL">(defaultFilter);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [date, setDate] = useState<Dayjs>(dayjs());
  const { data, isLoading } = useWaitingBookingsQuery(
    filter === "ALL" ? undefined : filter,
    search,
    isCompletedView ? date.format("YYYY-MM-DD") : undefined
  );

  function runSearch() {
    setSearch(searchInput.trim());
  }

  return (
    <Card title={title} extra={<Typography.Text type="secondary">{data?.length ?? 0} 笔</Typography.Text>}>
      {isCompletedView ? (
        <ResponsiveFilterBar>
          <DatePicker
            value={date}
            allowClear={false}
            onChange={(value) => value && setDate(value)}
            style={{ width: 160 }}
          />
          <Input
            allowClear
            placeholder="搜索 Booking ID / Girl 姓名"
            style={{ width: 220 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={runSearch}
          />
          <Button type="primary" icon={<SearchOutlined />} style={{ height: 44 }} onClick={runSearch}>
            搜索
          </Button>
        </ResponsiveFilterBar>
      ) : (
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
          <ResponsiveFilterBar>
            <Input
              allowClear
              placeholder="搜索 Booking ID / Girl 姓名"
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={runSearch}
            />
            <Button type="primary" icon={<SearchOutlined />} style={{ height: 44 }} onClick={runSearch}>
              搜索
            </Button>
          </ResponsiveFilterBar>
        </Space>
      )}

      {!isLoading && (!data || data.length === 0) ? (
        <Empty description={isCompletedView ? "这一天没有已完成的 Leg" : "没有符合条件的 Booking"} />
      ) : (
        <List
          loading={isLoading}
          dataSource={data}
          style={{ maxHeight: 600, overflowY: "auto" }}
          renderItem={(leg) => (
            <List.Item
              onClick={() => onSelectLeg(leg)}
              style={{
                cursor: isCompletedView ? "default" : "pointer",
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
                    <LegTypeTag legType={leg.legType} />
                    <LegStatusTag status={leg.status} />
                    {!isCompletedView && <Tag color={PRIORITY_COLOR[leg.priority]}>{PRIORITY_LABELS[leg.priority]}</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Typography.Text>
                      {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {isCompletedView
                        ? `完成时间：${formatLegDateTime(leg.completedAt)}`
                        : `预定时间：${formatLegDateTime(leg.scheduledAt)}`}
                      {leg.driver && ` · 司机：${leg.driver.name}`}
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
