import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Popconfirm, Result, Skeleton, Space, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useBookingQuery, useCancelBookingMutation } from "./hooks";
import { BookingStatusTag } from "./components/StatusTags";
import { LegList } from "./components/LegList";
import { BookingTimelineCard } from "./components/BookingTimelineCard";
import { AddLegModal } from "./components/AddLegModal";
import { EditBookingModal } from "./components/EditBookingModal";
import { formatCents } from "../../lib/money";
import { useIsMobile } from "../../common/useIsMobile";

export function BookingDetailPage() {
  const { id } = useParams();
  const bookingId = Number(id);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [addLegOpen, setAddLegOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: booking, isLoading } = useBookingQuery(bookingId);
  const cancelBooking = useCancelBookingMutation(bookingId);

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active />
      </div>
    );
  }

  if (!booking) {
    return <Result status="404" title="找不到这笔 Booking" />;
  }

  const canCancel = booking.status === "PENDING" || booking.status === "IN_PROGRESS";
  const canAddLeg = booking.status !== "CANCELLED";

  const allocatedCents = booking.legs
    .filter((leg) => leg.status !== "CANCELLED")
    .reduce((sum, leg) => sum + (leg.earningAllocationCents ?? 0), 0);
  const remainingCents = booking.driverPoolAmountCents - allocatedCents;

  const commissionLabel =
    booking.platformCommissionType === "PERCENTAGE"
      ? `${booking.platformCommissionValue}%`
      : formatCents(booking.platformCommissionValue);

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate("/")} style={{ paddingLeft: 0 }}>
        返回列表
      </Button>

      <Card
        title={
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Booking #{booking.id}
            </Typography.Title>
            <BookingStatusTag status={booking.status} />
          </Space>
        }
        extra={
          <Space wrap>
            <Button onClick={() => setEditOpen(true)}>编辑</Button>
            {canCancel && (
              <Popconfirm
                title="确定要取消整张 Booking 吗？"
                description="尚未完成的 Leg 会一并被取消。"
                onConfirm={async () => {
                  await cancelBooking.mutateAsync();
                  message.success("Booking 已取消");
                }}
              >
                <Button danger loading={cancelBooking.isPending}>
                  取消 Booking
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Descriptions column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="Girl 姓名">{booking.girlName}</Descriptions.Item>
          <Descriptions.Item label="建立时间">{new Date(booking.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Booking Total">{formatCents(booking.totalAmountCents)}</Descriptions.Item>
          <Descriptions.Item label="Platform Commission">{commissionLabel}</Descriptions.Item>
          <Descriptions.Item label="Platform Amount">{formatCents(booking.platformAmountCents)}</Descriptions.Item>
          <Descriptions.Item label="Driver Pool">{formatCents(booking.driverPoolAmountCents)}</Descriptions.Item>
          <Descriptions.Item label="Allocated to Legs">{formatCents(allocatedCents)}</Descriptions.Item>
          <Descriptions.Item label="Remaining Unallocated">{formatCents(remainingCents)}</Descriptions.Item>
          <Descriptions.Item label="备注" span={2}>
            {booking.notes ?? "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <BookingTimelineCard bookingId={booking.id} />

      <Card
        title="行程 Leg"
        extra={
          canAddLeg && (
            <Button type="primary" onClick={() => setAddLegOpen(true)}>
              + 新增 Leg
            </Button>
          )
        }
      >
        {booking.legs.length === 0 ? (
          <Typography.Text type="secondary">还没有任何 Leg</Typography.Text>
        ) : (
          <LegList bookingId={booking.id} legs={booking.legs} />
        )}
      </Card>

      <AddLegModal bookingId={booking.id} open={addLegOpen} onClose={() => setAddLegOpen(false)} />
      <EditBookingModal booking={booking} open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}
