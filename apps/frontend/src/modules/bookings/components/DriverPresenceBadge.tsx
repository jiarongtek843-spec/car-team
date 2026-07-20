import { Alert, Space, Tag, Typography } from "antd";
import { useDriverPresenceQuery } from "../../gps/hooks";
import { PRESENCE_STATUS_COLOR, PRESENCE_STATUS_LABELS } from "../../gps/types";

function formatSecondsAgo(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds} sec ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

/** Booking Detail 页面用，显示这个 Leg 目前负责 Driver 的实时状态；Offline 时要明显提示。 */
export function DriverPresenceBadge({ driverId }: { driverId: number }) {
  const { data: presence } = useDriverPresenceQuery(driverId);
  if (!presence) return null;

  if (presence.status === "OFFLINE") {
    return (
      <Alert type="warning" showIcon style={{ marginTop: 4, marginBottom: 4 }} message="该 Driver 目前 Offline" />
    );
  }

  return (
    <Space size={4}>
      <Tag color={PRESENCE_STATUS_COLOR[presence.status]}>{PRESENCE_STATUS_LABELS[presence.status]}</Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        GPS Updated {formatSecondsAgo(presence.secondsSinceUpdate)}
      </Typography.Text>
    </Space>
  );
}
