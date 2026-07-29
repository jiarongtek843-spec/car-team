import { Button, Card, Popconfirm, Space, Tag, Typography, message } from "antd";
import type { DriverLeg, LegWalletStatus } from "../types";
import { useAcceptLegMutation, useCompleteLegMutation, useMarkArrivingMutation, useMarkOnBoardMutation } from "../hooks";
import { LegTypeTag } from "../../bookings/components/StatusTags";
import { formatDuration, formatEstimatedFinish, formatLegDateTime } from "../../../lib/schedule";
import { formatCents } from "../../../lib/money";
import { ApiError } from "../../../api/http";

const WALLET_STATUS_LABEL: Record<LegWalletStatus, string> = {
  PENDING: "待结算",
  SETTLED: "已结算",
  VOIDED: "已作废"
};

const WALLET_STATUS_COLOR: Record<LegWalletStatus, string> = {
  PENDING: "gold",
  SETTLED: "success",
  VOIDED: "error"
};

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
        <Space wrap>
          <Typography.Text strong>Booking #{leg.booking.id}</Typography.Text>
          <LegTypeTag legType={leg.legType} />
          <Tag color={STATUS_COLOR[leg.status]}>{STATUS_LABEL[leg.status]}</Tag>
        </Space>
        <Typography.Text>Girl：{leg.booking.girlName}</Typography.Text>
        <Typography.Text>
          {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
        </Typography.Text>
        <Typography.Text type="secondary">预定时间：{formatLegDateTime(leg.scheduledAt)}</Typography.Text>
        <Typography.Text type="secondary">
          Duration：{formatDuration(leg.estimatedDurationMinutes)} · Finish：{formatEstimatedFinish(leg.estimatedFinishAt)}
        </Typography.Text>
        {leg.notes && <Typography.Text type="secondary">备注：{leg.notes}</Typography.Text>}
        {leg.status === "REJECTED" && leg.rejectionReason && (
          <Typography.Text type="danger">拒绝原因：{leg.rejectionReason}</Typography.Text>
        )}

        {leg.status === "COMPLETED" && (
          <Space direction="vertical" size={0} style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">完成时间：{formatLegDateTime(leg.completedAt)}</Typography.Text>
            <Typography.Text type="secondary">Booking Fare：{formatCents(leg.booking.totalAmountCents)}</Typography.Text>
            <Typography.Text strong>
              本趟司机收入：{leg.driverEarningCents !== null ? formatCents(leg.driverEarningCents) : "-"}
            </Typography.Text>
            <Space size={4}>
              <Typography.Text type="secondary">结算状态：</Typography.Text>
              {leg.walletStatus ? (
                <Tag color={WALLET_STATUS_COLOR[leg.walletStatus]}>{WALLET_STATUS_LABEL[leg.walletStatus]}</Tag>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              )}
            </Space>
            {leg.settlementReference && <Typography.Text type="secondary">结算单号：{leg.settlementReference}</Typography.Text>}
          </Space>
        )}

        <Space style={{ marginTop: 8 }}>
          {leg.status === "ASSIGNED" && (
            <>
              <Button
                type="primary"
                loading={accept.isPending}
                onClick={async () => {
                  try {
                    await accept.mutateAsync(leg.id);
                    message.success("已接受工作");
                  } catch (err) {
                    message.error(err instanceof ApiError ? err.message : "操作失败，请重试");
                  }
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
                try {
                  await markArriving.mutateAsync(leg.id);
                  message.success("已标记前往中");
                } catch (err) {
                  message.error(err instanceof ApiError ? err.message : "操作失败，请重试");
                }
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
                try {
                  await markOnBoard.mutateAsync(leg.id);
                  message.success("已标记乘客上车");
                } catch (err) {
                  message.error(err instanceof ApiError ? err.message : "操作失败，请重试");
                }
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
                try {
                  await complete.mutateAsync(leg.id);
                  message.success("工作已完成");
                } catch (err) {
                  message.error(err instanceof ApiError ? err.message : "操作失败，请重试");
                }
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
