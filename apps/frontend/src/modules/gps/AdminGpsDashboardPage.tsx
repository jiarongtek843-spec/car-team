import { useState } from "react";
import { Card, Col, Empty, Row, Space, Switch, Tag, Typography } from "antd";
import { useDriverPresenceListQuery } from "./hooks";
import { useIsMobile } from "../../common/useIsMobile";
import { PRESENCE_STATUS_COLOR, PRESENCE_STATUS_DOT, PRESENCE_STATUS_LABELS } from "./types";
import type { DriverPresence } from "./types";

function formatSecondsAgo(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

function DriverPresenceCard({ presence }: { presence: DriverPresence }) {
  return (
    <Card size="small">
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <Space>
          <span>{PRESENCE_STATUS_DOT[presence.status]}</span>
          <Typography.Text strong>{presence.driver.name}</Typography.Text>
          <Typography.Text type="secondary">{presence.driver.vehiclePlateNumber ?? "-"}</Typography.Text>
        </Space>
        <Tag color={PRESENCE_STATUS_COLOR[presence.status]}>{PRESENCE_STATUS_LABELS[presence.status]}</Tag>
        {presence.activeLeg && (
          <Typography.Text type="secondary">
            #{presence.activeLeg.bookingId} {presence.activeLeg.bookingGirlName} · Leg {presence.activeLeg.sequence}
          </Typography.Text>
        )}
        {presence.location ? (
          <>
            <Typography.Text>Lat: {presence.location.latitude.toFixed(6)}</Typography.Text>
            <Typography.Text>Lng: {presence.location.longitude.toFixed(6)}</Typography.Text>
            {presence.location.speed !== null && <Typography.Text>Speed: {presence.location.speed.toFixed(1)} m/s</Typography.Text>}
            {presence.location.batteryPercent !== null && (
              <Typography.Text>Battery: {presence.location.batteryPercent}%</Typography.Text>
            )}
            <Typography.Text type="secondary">Updated: {formatSecondsAgo(presence.secondsSinceUpdate)}</Typography.Text>
          </>
        ) : (
          <Typography.Text type="secondary">还没有 GPS 资料</Typography.Text>
        )}
      </Space>
    </Card>
  );
}

export function AdminGpsDashboardPage() {
  const [onlineOnly, setOnlineOnly] = useState(true);
  const { data, isLoading } = useDriverPresenceListQuery(onlineOnly);
  const isMobile = useIsMobile();

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          GPS Live Tracking
        </Typography.Title>
        <Space>
          <Typography.Text>只显示 Online</Typography.Text>
          <Switch checked={onlineOnly} onChange={setOnlineOnly} />
        </Space>
      </Space>

      {!isLoading && (!data || data.length === 0) && <Empty description="目前没有符合条件的 Driver" />}

      <Row gutter={[16, 16]}>
        {data?.map((presence) => (
          <Col key={presence.driver.id} xs={24} sm={12} md={8} lg={6}>
            <DriverPresenceCard presence={presence} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
