import { useState } from "react";
import { Badge, Button } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PERMISSIONS } from "../../../common/permissions";
import {
  useAdminNotificationsInfiniteQuery,
  useAdminUnreadCountQuery,
  useMarkAllAsReadMutation,
  useMarkNotificationReadMutation
} from "../hooks";
import { NotificationPanel } from "./NotificationPanel";
import type { Notification, NotificationAudience } from "../types";

/** Dispatcher 看自己的 DISPATCHER 通知；Owner/Manager 看 ADMIN 广播——两者共用同一支
 * Admin-side API（/api/notifications），只是 audience 参数不同。 */
function audienceForRole(roleKey: string): NotificationAudience {
  return roleKey === "DISPATCHER" ? "DISPATCHER" : "ADMIN";
}

export function AdminNotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const audience = audienceForRole(user?.role.key ?? "");
  const canView = Boolean(user?.permissions.includes(PERMISSIONS.NOTIFICATION_READ));

  const { data: unreadCount } = useAdminUnreadCountQuery(audience);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useAdminNotificationsInfiniteQuery(
    audience,
    canView && open
  );
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllAsReadMutation(audience);

  if (!canView) return null;

  const items = data?.pages.flatMap((p) => p.data) ?? [];

  function handleItemClick(notification: Notification) {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }
    if (notification.relatedBookingId) {
      setOpen(false);
      navigate(`/bookings/${notification.relatedBookingId}`);
    }
  }

  return (
    <>
      <Badge count={unreadCount ?? 0} size="small" offset={[-4, 4]}>
        <Button
          type="text"
          aria-label="通知"
          icon={<BellOutlined style={{ color: "#fff", fontSize: 18 }} />}
          onClick={() => setOpen(true)}
          style={{ minWidth: 44, minHeight: 44 }}
        />
      </Badge>
      <NotificationPanel
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        isLoading={isLoading}
        hasNextPage={Boolean(hasNextPage)}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
        onItemClick={handleItemClick}
        onMarkRead={(id) => markRead.mutate(id)}
        onMarkAllRead={() => markAllRead.mutate()}
        isMarkingAllRead={markAllRead.isPending}
      />
    </>
  );
}
