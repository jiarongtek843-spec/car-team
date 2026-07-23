import { Button, Card, Popconfirm, Space, Tag, Typography, message } from "antd";
import type { DriverLeg } from "../types";
import { useAcceptLegMutation, useCompleteLegMutation, useMarkArrivingMutation, useMarkOnBoardMutation } from "../hooks";

const STATUS_LABEL: Record<DriverLeg["status"], string> = {
  PENDING: "未指派",
  ASSIGNED: "待接受",
  ACCEPTED: "即将进行",
  DRIVER_ARRIVING: "司机前往中",
  PASSENGER_ON_BOARD: "乘客已上车",
  COMPLETED: "已完成",
  REJECTED: "已拒绝",
  CANCELLED: "已取消"
};

const STATUS_COLOR: Record<DriverLeg["status"], string> = {
  PENDING: "default",
  ASSIGNED: "gold",
  ACCEPTED: "blue",
  DRIVER_ARRIVING: "processing",
  PASSENGER_ON_BOARD: "processing",
  COMPLETED: "success",
  REJECTED: "error",
  CANCELLED: "default"
};

export function JobCard({ leg, onReject }: { leg: DriverLeg; onReject: (legId: number) => void }) {
  const accept = useAcceptLegMutation();
  const markArriving = useMarkArrivingMutation();
  const markOnBoard = useMarkOnBoardMutation();
  const complete = useCompleteLegMutation();

  return (
    <Card style={{ marginBottom: 12 }}>
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <Space>
          <Typography.Text strong>Booking #{leg.booking.id}</Typography.Text>
          <Tag color={STATUS_COLOR[leg.status]}>{STATUS_LABEL[leg.status]}</Tag>
        </Space>
        <Typography.Text>Girl：{leg.booking.girlName}</Typography.Text>
        <Typography.Text>
          {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
        </Typography.Text>
        <Typography.Text type="secondary">
          {leg.scheduledAt ? new Date(leg.scheduledAt).toLocaleString() : "未设定时间"}
        </Typography.Text>
        {leg.notes && <Typography.Text type="secondary">备注：{leg.notes}</Typography.Text>}
        {leg.status === "REJECTED" && leg.rejectionReason && (
          <Typography.Text type="danger">拒绝原因：{leg.rejectionReason}</Typography.Text>
        )}

        <Space style={{ marginTop: 8 }}>
          {leg.status === "ASSIGNED" && (
            <>
              <Button
                type="primary"
                loading={accept.isPending}
                onClick={async () => {
                  await accept.mutateAsync(leg.id);
                  message.success("已接受工作");
                }}
              >
                Accept
              </Button>
              <Button danger onClick={() => onReject(leg.id)}>
                Reject
              </Button>
            </>
          )}
          {leg.status === "ACCEPTED" && (
            <Button
              type="primary"
              loading={markArriving.isPending}
              onClick={async () => {
                await markArriving.mutateAsync(leg.id);
                message.success("已标记前往中");
              }}
            >
              Driver Arriving
            </Button>
          )}
          {leg.status === "DRIVER_ARRIVING" && (
            <Button
              type="primary"
              loading={markOnBoard.isPending}
              onClick={async () => {
                await markOnBoard.mutateAsync(leg.id);
                message.success("已标记乘客上车");
              }}
            >
              Passenger On Board
            </Button>
          )}
          {leg.status === "PASSENGER_ON_BOARD" && (
            <Popconfirm
              title="确定要标记这趟行程已完成吗？"
              description="完成后无法撤销，收入会立刻发放。"
              okText="确定完成"
              cancelText="再等等"
              onConfirm={async () => {
                await complete.mutateAsync(leg.id);
                message.success("工作已完成");
              }}
            >
              <Button type="primary" loading={complete.isPending}>
                Mark as Completed
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>
    </Card>
  );
}
