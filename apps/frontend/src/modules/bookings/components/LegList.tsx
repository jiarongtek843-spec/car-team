import { useState } from "react";
import { List, Popconfirm, Space, Typography, message } from "antd";
import type { Leg } from "../../../types/booking";
import { LegStatusTag, LegTypeTag } from "./StatusTags";
import { AssignDriverModal } from "./AssignDriverModal";
import { EditAllocationModal } from "./EditAllocationModal";
import { useCancelLegMutation, useDeleteLegMutation } from "../hooks";
import { formatCents } from "../../../lib/money";
import { formatLegDateTime } from "../../../lib/schedule";
import { DriverPresenceBadge } from "./DriverPresenceBadge";

const PRESENCE_TRACKED_STATUSES: Leg["status"][] = ["ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD"];

const REASSIGNABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];
const CANCELLABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];
const ALLOCATION_EDITABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];

const STAGE_TIMESTAMPS: { key: keyof Leg; label: string }[] = [
  { key: "assignedAt", label: "指派" },
  { key: "acceptedAt", label: "接受" },
  { key: "driverArrivingAt", label: "前往中" },
  { key: "passengerOnBoardAt", label: "已上车" },
  { key: "completedAt", label: "完成" },
  { key: "rejectedAt", label: "拒绝" }
];

export function LegList({ bookingId, legs }: { bookingId: number; legs: Leg[] }) {
  const [assigningLegId, setAssigningLegId] = useState<number | null>(null);
  const [allocatingLeg, setAllocatingLeg] = useState<Leg | null>(null);
  const cancelLeg = useCancelLegMutation(bookingId);
  const deleteLeg = useDeleteLegMutation(bookingId);

  return (
    <>
      <List
        dataSource={[...legs].sort((a, b) => a.sequence - b.sequence)}
        renderItem={(leg) => (
          <List.Item
            actions={[
              REASSIGNABLE.includes(leg.status) && (
                <a key="assign" onClick={() => setAssigningLegId(leg.id)}>
                  {leg.driver ? "重新指派" : "指派司机"}
                </a>
              ),
              ALLOCATION_EDITABLE.includes(leg.status) && (
                <a key="allocation" onClick={() => setAllocatingLeg(leg)}>
                  设定收入
                </a>
              ),
              CANCELLABLE.includes(leg.status) && (
                <Popconfirm
                  key="cancel"
                  title="确定要取消这段行程吗？"
                  onConfirm={async () => {
                    await cancelLeg.mutateAsync(leg.id);
                    message.success("已取消该 Leg");
                  }}
                >
                  <a>取消</a>
                </Popconfirm>
              ),
              leg.status === "PENDING" && (
                <Popconfirm
                  key="delete"
                  title="确定要删除这段行程吗？"
                  onConfirm={async () => {
                    await deleteLeg.mutateAsync(leg.id);
                    message.success("已删除该 Leg");
                  }}
                >
                  <a style={{ color: "#ff4d4f" }}>删除</a>
                </Popconfirm>
              )
            ].filter(Boolean)}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Typography.Text strong>Leg {leg.sequence}</Typography.Text>
                  <LegTypeTag legType={leg.legType} />
                  <LegStatusTag status={leg.status} />
                </Space>
              }
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    预定时间：{formatLegDateTime(leg.scheduledAt)}
                    {" · "}
                    司机：{leg.driver ? leg.driver.name : "未指派"}
                    {" · "}
                    司机收入：{formatCents(leg.earningAllocationCents)}
                  </Typography.Text>
                  {leg.driver && PRESENCE_TRACKED_STATUSES.includes(leg.status) && (
                    <DriverPresenceBadge driverId={leg.driver.id} />
                  )}
                  {leg.notes && <Typography.Text type="secondary">备注：{leg.notes}</Typography.Text>}
                  {leg.status === "REJECTED" && leg.rejectionReason && (
                    <Typography.Text type="danger">拒绝原因：{leg.rejectionReason}</Typography.Text>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {STAGE_TIMESTAMPS.filter((stage) => leg[stage.key])
                      .map((stage) => `${stage.label} ${new Date(leg[stage.key] as string).toLocaleString()}`)
                      .join(" · ")}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <AssignDriverModal bookingId={bookingId} legId={assigningLegId} onClose={() => setAssigningLegId(null)} />
      <EditAllocationModal bookingId={bookingId} leg={allocatingLeg} onClose={() => setAllocatingLeg(null)} />
    </>
  );
}
