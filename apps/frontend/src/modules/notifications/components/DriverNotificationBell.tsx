import { useState } from "react";
import { Badge, Button } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useAuth } from "../../auth/AuthContext";
import { PERMISSIONS } from "../../../common/permissions";
import {
  useDriverNotificationsInfiniteQuery,
  useDriverUnreadCountQuery,
  useMarkAllMyNotificationsReadMutation,
  useMarkMyNotificationReadMutation
} from "../hooks";
import { NotificationPanel } from "./NotificationPanel";
import type { Notification } from "../types";

export function DriverNotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const canView = Boolean(user?.permissions.includes(PERMISSIONS.DRIVER_NOTIFICATION_SELF));

  const { data: unreadCount } = useDriverUnreadCountQuery();
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useDriverNotificationsInfiniteQuery(canView && open);
  const markRead = useMarkMyNotificationReadMutation();
  const markAllRead = useMarkAllMyNotificationsReadMutation();

  if (!canView) return null;

  const items = data?.pages.flatMap((p) => p.data) ?? [];

  function handleItemClick(notification: Notification) {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }
    // Driver Portal 目前没有对应的 Booking 详情页（那是 Admin-only 路由，见
    // RequireAuth.tsx 的 portal 隔离），所以这里不做 relatedBookingId 导航，只标已读。
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
