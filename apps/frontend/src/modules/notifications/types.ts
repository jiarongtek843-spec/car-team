export type NotificationAudience = "DRIVER" | "DISPATCHER" | "ADMIN";

// type 沿用后端 ActivityLog.activityType 的纯字串精神（例如 "BOOKING_CREATED"）——目前只
// 拿来当一个可显示的 Tag，还没有任何 Category/Filter 逻辑绑在特定字串上。未来要照 Dispatch/
// Wallet/Settlement/GPS/Finance/System 分类，可以直接对这个栏位做前缀比对或另外查表，不需要
// 改这个型别或 API 形状。
export interface Notification {
  id: number;
  audience: NotificationAudience;
  driverId: number | null;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  relatedBookingId: number | null;
  relatedUrl: string | null;
  sourceActivityId: number | null;
  createdAt: string;
}
