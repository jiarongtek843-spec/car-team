import { useState } from "react";
import { Alert, Button, Card, Empty, Input, List, Select, Space, Tag, Typography, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useDispatchAssignMutation, useDispatchDriversQuery, useSuggestedDriversQuery } from "../hooks";
import { GPS_STATUS_COLOR, GPS_STATUS_LABELS } from "../types";
import type { DispatchWaitingLeg, DriverDispatchFilter } from "../types";
import { ResponsiveFilterBar } from "../../../common/ResponsiveFilterBar";

/**
 * Phase 1 Driver Eligibility + Ranking Engine 的建议名单——只在选好一笔等派车的 Leg 之后
 * 才出现在既有 Driver List 上方，纯粹是排序参考，点 Assign 走的是同一支既有 API，
 * Dispatcher 永远可以直接忽略这个区块、照旧从下面完整名单手动挑人。
 */
function SuggestedDriversSection({
  selectedLeg,
  onAssign,
  assignPending
}: {
  selectedLeg: DispatchWaitingLeg;
  onAssign: (driverId: number) => void;
  assignPending: boolean;
}) {
  const { data, isLoading } = useSuggestedDriversQuery(selectedLeg.legId);

  if (isLoading || !data || data.suggestions.length === 0) {
    return null;
  }

  return (
    <Card size="small" title="建议 Driver（按距离/空档排序）" style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {data.suggestions.map((s) => (
          <Space key={s.driver.id} style={{ width: "100%", justifyContent: "space-between" }} wrap>
            <Space>
              <Tag>{s.rank}</Tag>
              <Typography.Text strong>{s.driver.name}</Typography.Text>
              <Typography.Text type="secondary">
                {s.distanceKm !== null ? `${s.distanceKm.toFixed(1)} km` : `今日 ${s.completedToday} 趟`}
              </Typography.Text>
            </Space>
            <Button size="small" type="primary" loading={assignPending} onClick={() => onAssign(s.driver.id)}>
              Assign
            </Button>
          </Space>
        ))}
      </Space>
    </Card>
  );
}

const FILTER_OPTIONS: { label: string; value: DriverDispatchFilter | "ALL" }[] = [
  { label: "全部", value: "ALL" },
  { label: "Online", value: "ONLINE" },
  { label: "Offline", value: "OFFLINE" },
  { label: "Connection Lost", value: "CONNECTION_LOST" },
  { label: "Busy", value: "BUSY" },
  { label: "Idle", value: "IDLE" }
];

function formatSecondsAgo(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds} sec ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

export function DriverListPanel({
  selectedLeg,
  onAssigned
}: {
  selectedLeg: DispatchWaitingLeg | null;
  onAssigned: () => void;
}) {
  const [filter, setFilter] = useState<DriverDispatchFilter | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { data, isLoading } = useDispatchDriversQuery(filter === "ALL" ? undefined : filter, search);
  const assign = useDispatchAssignMutation();

  function runSearch() {
    setSearch(searchInput.trim());
  }

  async function handleAssign(driverId: number) {
    if (!selectedLeg) return;
    try {
      await assign.mutateAsync({ bookingId: selectedLeg.bookingId, legId: selectedLeg.legId, driverId });
      message.success("已指派 Driver");
      onAssigned();
    } catch {
      message.error("指派失败，请重试");
    }
  }

  return (
    <Card title="Driver List" extra={<Typography.Text type="secondary">{data?.length ?? 0} 位</Typography.Text>}>
      {selectedLeg ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`正在指派：#${selectedLeg.bookingId} ${selectedLeg.girlName} · Leg ${selectedLeg.sequence}${
            selectedLeg.driver ? `（目前：${selectedLeg.driver.name}，点选下方 Driver 即可 Reassign）` : ""
          }`}
        />
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="先在左边选一笔 Booking，才能指派 Driver" />
      )}

      {selectedLeg && (
        <SuggestedDriversSection selectedLeg={selectedLeg} onAssign={handleAssign} assignPending={assign.isPending} />
      )}

      <ResponsiveFilterBar>
        <Select
          style={{ width: 160 }}
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(v) => setFilter(v as DriverDispatchFilter | "ALL")}
        />
        <Input
          allowClear
          placeholder="搜索 Driver 姓名 / 电话"
          style={{ width: 200 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={runSearch}
        />
        <Button icon={<SearchOutlined />} style={{ height: 44 }} onClick={runSearch}>
          搜索
        </Button>
      </ResponsiveFilterBar>

      {!isLoading && (!data || data.length === 0) ? (
        <Empty description="没有符合条件的 Driver" />
      ) : (
        <List
          loading={isLoading}
          dataSource={data}
          style={{ maxHeight: 560, overflowY: "auto" }}
          renderItem={(item) => (
            <List.Item
              actions={
                selectedLeg
                  ? [
                      <Button
                        key="assign"
                        type="primary"
                        size="small"
                        loading={assign.isPending}
                        onClick={() => handleAssign(item.driver.id)}
                      >
                        {selectedLeg.driver ? "Reassign" : "Assign"}
                      </Button>
                    ]
                  : []
              }
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text strong>{item.driver.name}</Typography.Text>
                    <Typography.Text type="secondary">{item.driver.vehiclePlateNumber ?? "-"}</Typography.Text>
                    <Tag color={GPS_STATUS_COLOR[item.gpsStatus]}>{GPS_STATUS_LABELS[item.gpsStatus]}</Tag>
                    <Tag color={item.workloadStatus === "BUSY" ? "processing" : "default"}>{item.workloadStatus}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Typography.Text type="secondary">
                      Current Jobs: {item.currentJobs} · Pending: {item.pendingJobs} · Completed Today:{" "}
                      {item.completedToday}
                    </Typography.Text>
                    <Typography.Text type="secondary">GPS Updated: {formatSecondsAgo(item.secondsSinceUpdate)}</Typography.Text>
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
