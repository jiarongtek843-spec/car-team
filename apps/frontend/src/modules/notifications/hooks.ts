import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { message } from "antd";
import * as notificationsApi from "./api";
import type { NotificationAudience } from "./types";

const PAGE_SIZE = 20;

// Stabilization Bug Fix：这四个 mutation 之前完全没有 onError——标为已读失败不影响
// 业务正确性，但至少该让使用者知道点了没反应，不是当作没这回事。
function reportMarkReadError() {
  message.error("标记已读失败，请重试");
}

// 未读数量刻意重用既有的 List API（isRead=false, pageSize=1，只要 total）而不是另外开一个
// unread-count 端点——後端目前没有、也不需要为了一个数字多开一支 API。

export function useAdminUnreadCountQuery(audience: NotificationAudience) {
  return useQuery({
    queryKey: ["notifications", "admin", "unreadCount", audience],
    queryFn: () => notificationsApi.fetchNotifications({ audience, isRead: false, page: 1, pageSize: 1 }),
    select: (result) => result.total,
    refetchInterval: 30000
  });
}

export function useAdminNotificationsInfiniteQuery(audience: NotificationAudience, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["notifications", "admin", "infinite", audience],
    queryFn: ({ pageParam }) => notificationsApi.fetchNotifications({ audience, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "admin"] }),
    onError: reportMarkReadError
  });
}

/** 后端没有 Mark All as Read 的批次端点，这里用既有的 List + 逐笔 Mark Read 组合出来
 * （公司规模小，未读量不会大到需要专门的批次 API——真的需要时再加）。 */
export function useMarkAllAsReadMutation(audience: NotificationAudience) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const ids: number[] = [];
      for (let page = 1; ; page += 1) {
        const result = await notificationsApi.fetchNotifications({ audience, isRead: false, page, pageSize: 100 });
        ids.push(...result.data.map((n) => n.id));
        if (page * 100 >= result.total) break;
      }
      await Promise.all(ids.map((id) => notificationsApi.markNotificationRead(id)));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "admin"] }),
    onError: reportMarkReadError
  });
}

export function useDriverUnreadCountQuery() {
  return useQuery({
    queryKey: ["notifications", "driver", "unreadCount"],
    queryFn: () => notificationsApi.fetchMyNotifications({ isRead: false, page: 1, pageSize: 1 }),
    select: (result) => result.total,
    refetchInterval: 30000
  });
}

export function useDriverNotificationsInfiniteQuery(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["notifications", "driver", "infinite"],
    queryFn: ({ pageParam }) => notificationsApi.fetchMyNotifications({ page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled
  });
}

export function useMarkMyNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markMyNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "driver"] }),
    onError: reportMarkReadError
  });
}

export function useMarkAllMyNotificationsReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const ids: number[] = [];
      for (let page = 1; ; page += 1) {
        const result = await notificationsApi.fetchMyNotifications({ isRead: false, page, pageSize: 100 });
        ids.push(...result.data.map((n) => n.id));
        if (page * 100 >= result.total) break;
      }
      await Promise.all(ids.map((id) => notificationsApi.markMyNotificationRead(id)));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "driver"] }),
    onError: reportMarkReadError
  });
}
