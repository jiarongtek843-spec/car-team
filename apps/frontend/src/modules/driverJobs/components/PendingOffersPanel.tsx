import { Alert, Button, Card, Space, Tag, Typography, message } from "antd";
import { useAcceptOfferMutation, useDeclineOfferMutation, useMyOffersQuery } from "../hooks";
import { formatLegDateTime } from "../../../lib/schedule";

/**
 * Phase 1 Dispatch Engine（简化版）：Driver 端的 Offer 卡片——先接先赢，逾时或被别人
 * 抢先都会在下一次轮询（3 秒）时自动从名单消失，不需要 Driver 手动刷新页面。
 * 没有 Offer 时整个区块不显示，不占版面。
 */
export function PendingOffersPanel() {
  const { data: offers } = useMyOffersQuery();
  const accept = useAcceptOfferMutation();
  const decline = useDeclineOfferMutation();

  if (!offers || offers.length === 0) {
    return null;
  }

  return (
    <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }} size={12}>
      {offers.map((offer) => (
        <Card key={offer.id} style={{ borderColor: "#faad14" }}>
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color="gold">新工作邀约</Tag>
              <Typography.Text strong>
                Booking #{offer.leg.booking.id} {offer.leg.booking.girlName}
              </Typography.Text>
            </Space>
            <Typography.Text>
              {offer.leg.pickupLocation ?? "—"} → {offer.leg.dropoffLocation ?? "—"}
            </Typography.Text>
            <Typography.Text type="secondary">预定时间：{formatLegDateTime(offer.leg.scheduledAt)}</Typography.Text>
            {offer.distanceKm !== null && (
              <Typography.Text type="secondary">距离约 {offer.distanceKm.toFixed(1)} km</Typography.Text>
            )}
            <Alert
              type="warning"
              showIcon
              message="先接先赢，逾时或被其他司机抢先会自动失效"
              style={{ marginTop: 4 }}
            />
            <Space style={{ marginTop: 8 }}>
              <Button
                type="primary"
                loading={accept.isPending}
                onClick={async () => {
                  try {
                    await accept.mutateAsync(offer.id);
                    message.success("已接受，工作已加入你的名单");
                  } catch {
                    message.error("接受失败，可能已经被抢先或已逾时");
                  }
                }}
              >
                Accept
              </Button>
              <Button
                danger
                loading={decline.isPending}
                onClick={async () => {
                  try {
                    await decline.mutateAsync(offer.id);
                    message.success("已拒绝这笔邀约");
                  } catch {
                    message.error("操作失败，请重试");
                  }
                }}
              >
                Decline
              </Button>
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}
