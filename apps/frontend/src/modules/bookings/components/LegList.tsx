import { useState } from "react";
import { List, Popconfirm, Space, Typography, message } from "antd";
import type { Leg } from "../../../types/booking";
import { LegStatusTag } from "./StatusTags";
import { AssignDriverModal } from "./AssignDriverModal";
import { useCancelLegMutation, useCompleteLegMutation, useDeleteLegMutation, useStartLegMutation } from "../hooks";

export function LegList({ bookingId, legs }: { bookingId: number; legs: Leg[] }) {
  const [assigningLegId, setAssigningLegId] = useState<number | null>(null);
  const startLeg = useStartLegMutation(bookingId);
  const completeLeg = useCompleteLegMutation(bookingId);
  const cancelLeg = useCancelLegMutation(bookingId);
  const deleteLeg = useDeleteLegMutation(bookingId);

  return (
    <>
      <List
        dataSource={[...legs].sort((a, b) => a.sequence - b.sequence)}
        renderItem={(leg) => (
          <List.Item
            actions={[
              (leg.status === "PENDING" || leg.status === "IN_PROGRESS") && (
                <a key="assign" onClick={() => setAssigningLegId(leg.id)}>
                  {leg.driver ? "更换司机" : "指派司机"}
                </a>
              ),
              leg.status === "PENDING" && (
                <a
                  key="start"
                  onClick={async () => {
                    if (!leg.driverId) {
                      message.warning("请先指派司机才能开始行程");
                      return;
                    }
                    await startLeg.mutateAsync(leg.id);
                    message.success("已开始行程");
                  }}
                >
                  开始
                </a>
              ),
              leg.status === "IN_PROGRESS" && (
                <a
                  key="complete"
                  onClick={async () => {
                    await completeLeg.mutateAsync(leg.id);
                    message.success("行程已完成");
                  }}
                >
                  完成
                </a>
              ),
              (leg.status === "PENDING" || leg.status === "IN_PROGRESS") && (
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
                  <LegStatusTag status={leg.status} />
                </Space>
              }
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {leg.scheduledAt ? new Date(leg.scheduledAt).toLocaleString() : "未设定时间"}
                    {" · "}
                    司机：{leg.driver ? leg.driver.name : "未指派"}
                  </Typography.Text>
                  {leg.notes && <Typography.Text type="secondary">备注：{leg.notes}</Typography.Text>}
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <AssignDriverModal bookingId={bookingId} legId={assigningLegId} onClose={() => setAssigningLegId(null)} />
    </>
  );
}
