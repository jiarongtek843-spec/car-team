import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Popconfirm, Result, Skeleton, Space, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useBookingQuery, useCancelBookingMutation } from "./hooks";
import { BookingStatusTag } from "./components/StatusTags";
import { LegList } from "./components/LegList";
import { AddLegModal } from "./components/AddLegModal";

export function BookingDetailPage() {
  const { id } = useParams();
  const bookingId = Number(id);
  const navigate = useNavigate();
  const [addLegOpen, setAddLegOpen] = useState(false);

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

  return (
    <div style={{ padding: 24 }}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate("/")} style={{ paddingLeft: 0 }}>
        返回列表
      </Button>

      <Card
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Booking #{booking.id}
            </Typography.Title>
            <BookingStatusTag status={booking.status} />
          </Space>
        }
        extra={
          canCancel && (
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
          )
        }
        style={{ marginBottom: 24 }}
      >
        <Descriptions column={2}>
          <Descriptions.Item label="Girl 姓名">{booking.girlName}</Descriptions.Item>
          <Descriptions.Item label="车费">{booking.carFee ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="建立时间">{new Date(booking.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="备注" span={2}>
            {booking.notes ?? "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

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
    </div>
  );
}
