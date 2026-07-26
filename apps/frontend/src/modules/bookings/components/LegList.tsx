import { useState } from "react";
import { Button, Card, Popconfirm, Space, Typography, message } from "antd";
import type { Leg } from "../../../types/booking";
import { LegStatusTag, LegTypeTag } from "./StatusTags";
import { AssignDriverModal } from "./AssignDriverModal";
import { EditLegModal } from "./EditLegModal";
import { useCancelLegMutation, useDeleteLegMutation } from "../hooks";
import { formatCents } from "../../../lib/money";
import { formatDuration, formatEstimatedFinish, formatLegDateTime } from "../../../lib/schedule";
import { DriverPresenceBadge } from "./DriverPresenceBadge";

const PRESENCE_TRACKED_STATUSES: Leg["status"][] = ["ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD"];

const REASSIGNABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];
const CANCELLABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];
const EDITABLE: Leg["status"][] = ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"];

const STAGE_TIMESTAMPS: { key: keyof Leg; label: string }[] = [
  { key: "assignedAt", label: "指派" },
  { key: "acceptedAt", label: "接受" },
  { key: "driverArrivingAt", label: "前往中" },
  { key: "passengerOnBoardAt", label: "已上车" },
  { key: "completedAt", label: "完成" },
  { key: "rejectedAt", label: "拒绝" }
];

/** 圆形小徽章，只放 Leg 编号——跟 LegTypeTag/LegStatusTag 分开，一眼就能扫到第几段行程。 */
function LegBadge({ sequence }: { sequence: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "#1677ff",
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0
      }}
    >
      {sequence}
    </span>
  );
}

function LegCard({
  leg,
  onAssign,
  onEdit,
  onCancel,
  onDelete
}: {
  leg: Leg;
  onAssign: () => void;
  onEdit: () => void;
  onCancel: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }} styles={{ body: { padding: 14 } }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {/* 横向排列的标题列：Leg 编号 + 类型 + 状态，不允许换行拆散。 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", overflowX: "auto" }}>
          <LegBadge sequence={leg.sequence} />
          <LegTypeTag legType={leg.legType} />
          <LegStatusTag status={leg.status} />
        </div>

        <Typography.Text>
          {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
        </Typography.Text>

        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary">Pickup：{formatLegDateTime(leg.scheduledAt)}</Typography.Text>
          <Typography.Text type="secondary">
            Duration：{formatDuration(leg.estimatedDurationMinutes)} · Finish：{formatEstimatedFinish(leg.estimatedFinishAt)}
          </Typography.Text>
          <Typography.Text type="secondary">司机：{leg.driver ? leg.driver.name : "未指派"}</Typography.Text>
        </Space>

        {/* 司机收入清楚独立一行显示，不跟其他资讯混在一起。 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(22,119,255,0.08)"
          }}
        >
          <Typography.Text type="secondary">司机收入</Typography.Text>
          <Typography.Text strong style={{ color: "#1677ff" }}>
            {formatCents(leg.earningAllocationCents)}
          </Typography.Text>
        </div>

        {leg.driver && PRESENCE_TRACKED_STATUSES.includes(leg.status) && <DriverPresenceBadge driverId={leg.driver.id} />}
        {leg.notes && <Typography.Text type="secondary">备注：{leg.notes}</Typography.Text>}
        {leg.status === "REJECTED" && leg.rejectionReason && (
          <Typography.Text type="danger">拒绝原因：{leg.rejectionReason}</Typography.Text>
        )}

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {STAGE_TIMESTAMPS.filter((stage) => leg[stage.key])
            .map((stage) => `${stage.label} ${new Date(leg[stage.key] as string).toLocaleString()}`)
            .join(" · ")}
        </Typography.Text>

        <Space wrap size={8} style={{ marginTop: 4 }}>
          {REASSIGNABLE.includes(leg.status) && (
            <Button size="small" onClick={onAssign}>
              {leg.driver ? "重新指派" : "指派司机"}
            </Button>
          )}
          {EDITABLE.includes(leg.status) && (
            <Button size="small" onClick={onEdit}>
              Edit Leg
            </Button>
          )}
          {CANCELLABLE.includes(leg.status) && (
            <Popconfirm title="确定要取消这段行程吗？" onConfirm={onCancel}>
              <Button size="small">取消</Button>
            </Popconfirm>
          )}
          {leg.status === "PENDING" && (
            <Popconfirm title="确定要删除这段行程吗？" onConfirm={onDelete}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>
    </Card>
  );
}

export function LegList({ bookingId, legs }: { bookingId: number; legs: Leg[] }) {
  const [assigningLegId, setAssigningLegId] = useState<number | null>(null);
  const [editingLeg, setEditingLeg] = useState<Leg | null>(null);
  const cancelLeg = useCancelLegMutation(bookingId);
  const deleteLeg = useDeleteLegMutation(bookingId);

  return (
    <>
      {[...legs]
        .sort((a, b) => a.sequence - b.sequence)
        .map((leg) => (
          <LegCard
            key={leg.id}
            leg={leg}
            onAssign={() => setAssigningLegId(leg.id)}
            onEdit={() => setEditingLeg(leg)}
            onCancel={async () => {
              await cancelLeg.mutateAsync(leg.id);
              message.success("已取消该 Leg");
            }}
            onDelete={async () => {
              await deleteLeg.mutateAsync(leg.id);
              message.success("已删除该 Leg");
            }}
          />
        ))}

      <AssignDriverModal bookingId={bookingId} legId={assigningLegId} onClose={() => setAssigningLegId(null)} />
      <EditLegModal bookingId={bookingId} leg={editingLeg} onClose={() => setEditingLeg(null)} />
    </>
  );
}
