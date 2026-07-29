import { http } from "../../api/http";
import type { PagedResult } from "../../types/booking";
import type { Notification, NotificationAudience } from "./types";

export interface ListNotificationsParams {
  audience?: NotificationAudience;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}

function toQueryString(params: ListNotificationsParams) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

// Admin/Dispatcher 端（/api/notifications，RBAC: notification:read/write）。
export function fetchNotifications(params: ListNotificationsParams) {
  return http.get<PagedResult<Notification>>(`/api/notifications${toQueryString(params)}`);
}

export function markNotificationRead(id: number) {
  return http.patch<Notification>(`/api/notifications/${id}/read`);
}

export function markNotificationUnread(id: number) {
  return http.patch<Notification>(`/api/notifications/${id}/unread`);
}

// Driver 端（/api/driver/notifications，RBAC: driverNotification:self，自动 scope 到自己）。
export function fetchMyNotifications(params: Omit<ListNotificationsParams, "audience">) {
  return http.get<PagedResult<Notification>>(`/api/driver/notifications${toQueryString(params)}`);
}

export function markMyNotificationRead(id: number) {
  return http.patch<Notification>(`/api/driver/notifications/${id}/read`);
}

export function markMyNotificationUnread(id: number) {
  return http.patch<Notification>(`/api/driver/notifications/${id}/unread`);
}
