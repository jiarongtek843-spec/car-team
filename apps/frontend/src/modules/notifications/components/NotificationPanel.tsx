import { Button, Drawer, Empty, Skeleton, Space, Typography } from "antd";
import { useIsMobile } from "../../../common/useIsMobile";
import type { Notification } from "../types";
import { NotificationListItem } from "./NotificationListItem";

export function NotificationPanel({
  open,
  onClose,
  items,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onItemClick,
  onMarkRead,
  onMarkAllRead,
  isMarkingAllRead
}: {
  open: boolean;
  onClose: () => void;
  items: Notification[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onItemClick: (notification: Notification) => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  isMarkingAllRead: boolean;
}) {
  const isMobile = useIsMobile();
  const hasUnread = items.some((n) => !n.isRead);

  return (
    <Drawer
      title="通知"
      placement="right"
      open={open}
      onClose={onClose}
      width={isMobile ? "100%" : 400}
      styles={{ body: { padding: 0 } }}
      extra={
        <Button type="link" size="small" disabled={!hasUnread} loading={isMarkingAllRead} onClick={onMarkAllRead}>
          全部标为已读
        </Button>
      }
    >
      {isLoading ? (
        <div style={{ padding: 16 }}>
          <Skeleton active />
        </div>
      ) : items.length === 0 ? (
        <Empty description="还没有任何通知" style={{ marginTop: 64 }} />
      ) : (
        <>
          {items.map((notification) => (
            <NotificationListItem
              key={notification.id}
              notification={notification}
              onClick={() => onItemClick(notification)}
              onMarkRead={() => onMarkRead(notification.id)}
            />
          ))}
          {hasNextPage && (
            <div style={{ padding: 16, textAlign: "center" }}>
              <Space>
                <Button loading={isFetchingNextPage} onClick={onLoadMore}>
                  载入更多
                </Button>
              </Space>
            </div>
          )}
          {!hasNextPage && (
            <Typography.Text type="secondary" style={{ display: "block", textAlign: "center", padding: 16, fontSize: 12 }}>
              已经到底了
            </Typography.Text>
          )}
        </>
      )}
    </Drawer>
  );
}
