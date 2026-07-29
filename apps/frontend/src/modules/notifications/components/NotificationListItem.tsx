import { Button, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { Notification } from "../types";

function formatTime(value: string) {
  return dayjs(value).format("YYYY-MM-DD HH:mm");
}

export function NotificationListItem({
  notification,
  onClick,
  onMarkRead
}: {
  notification: Notification;
  onClick: () => void;
  onMarkRead: () => void;
}) {
  const unread = !notification.isRead;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{
        display: "flex",
        gap: 10,
        padding: "12px 16px",
        cursor: "pointer",
        background: unread ? "#e6f4ff" : "transparent",
        borderBottom: "1px solid #f0f0f0"
      }}
    >
      <div style={{ width: 8, paddingTop: 6, flexShrink: 0 }}>
        {unread && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1677ff" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <Typography.Text strong={unread} style={{ fontSize: 14 }}>
            {notification.title}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            {formatTime(notification.createdAt)}
          </Typography.Text>
        </div>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: "4px 0 6px", fontSize: 13 }}
          ellipsis={{ rows: 2 }}
        >
          {notification.message}
        </Typography.Paragraph>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Tag style={{ marginInlineEnd: 0 }}>{notification.type}</Tag>
          {unread && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead();
              }}
            >
              标为已读
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
