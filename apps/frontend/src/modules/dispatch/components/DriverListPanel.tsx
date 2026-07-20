import { useState } from "react";
import { Alert, Button, Card, Empty, Input, List, Select, Space, Tag, Typography, message } from "antd";
import { useDispatchAssignMutation, useDispatchDriversQuery } from "../hooks";
import { GPS_STATUS_COLOR, GPS_STATUS_LABELS } from "../types";
import type { DispatchWaitingLeg, DriverDispatchFilter } from "../types";

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
  const { data, isLoading } = useDispatchDriversQuery(filter === "ALL" ? undefined : filter, search);
  const assign = useDispatchAssignMutation();

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

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          style={{ width: 160 }}
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(v) => setFilter(v as DriverDispatchFilter | "ALL")}
        />
        <Input.Search allowClear placeholder="搜索 Driver 姓名 / 电话" onSearch={setSearch} style={{ width: 200 }} />
      </Space>

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
