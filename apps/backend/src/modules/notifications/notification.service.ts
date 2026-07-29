import type { ActivityLog, Notification, NotificationAudience, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError, ValidationError } from "../../common/errors.js";
import { subscribeToActivity } from "../activityLog/activityLog.service.js";

/**
 * Notification Center（2026-07）：Notification 只有两个来源——
 *
 * 1. 自动：subscribeToActivity() 注册的 handleActivity()，每次有人呼叫
 *    activityLog.service.ts 的 createActivity() 就会跑一次，依照下面的 Rule 决定要不要建立
 *    Notification、给哪个 Audience。业务模块（Wallet/GPS/Dispatch/...）永远只呼叫
 *    createActivity()，不会、也没有管道直接建立 Notification——这个档案没有汇出任何给
 *    「模块」调用的 create 函式，只有 handleActivity()（Activity Log 内部呼叫）跟
 *    createManualNotification()（下面第 2 点，给「人」用）。
 *
 * 2. 手动：createManualNotification()，给 POST /api/notifications 这个 CRUD 入口用——
 *    例如 Owner 要发一则系统公告（"明天系统维护"），这不对应任何业务事件，本来就不该硬凑一笔
 *    ActivityLog 出来。这条路径不写 ActivityLog，sourceActivityId 是 null。
 */

// ---------------------------------------------------------------------------
// Rule engine：把 ActivityLog 转成 0..N 笔 Notification 草稿。
// ---------------------------------------------------------------------------

export interface NotificationDraft {
  audience: NotificationAudience;
  /** 只有 audience=DRIVER 才需要；其他 audience 是广播，不填。 */
  driverId?: number | null;
  type: string;
  title: string;
  message: string;
  relatedBookingId?: number | null;
  relatedUrl?: string | null;
}

export interface NotificationRule {
  /** 只在 module 相符时才套用。 */
  module: string;
  /** 省略代表整个 module 都套用；有填才只匹配这个 activityType。 */
  activityType?: string;
  build: (activity: ActivityLog) => NotificationDraft[];
}

const rules: NotificationRule[] = [];

/**
 * 让未来的模块可以为特定 (module, activityType) 客制化 Notification 内容（更精准的标题、
 * relatedUrl 等），不用改这个档案本身。没有註冊规则的事件一律套用 defaultDrafts() 这个
 * 保底规则，所以「模块只呼叫 createActivity()」这件事从今天就成立——不需要等每个模块都补一次
 * registerNotificationRule() 才看得到通知。
 */
export function registerNotificationRule(rule: NotificationRule) {
  rules.push(rule);
}

/** 找不到客制化规则时的保底行为：结构化欄位本身就够决定谁该收到通知。 */
function defaultDrafts(activity: ActivityLog): NotificationDraft[] {
  const relatedBookingId = activity.entityType === "Booking" ? activity.entityId : null;
  const drafts: NotificationDraft[] = [];

  if (activity.subjectDriverId) {
    drafts.push({
      audience: "DRIVER",
      driverId: activity.subjectDriverId,
      type: activity.activityType,
      title: activity.activityType,
      message: activity.summary,
      relatedBookingId
    });
  }

  if (activity.module === "DISPATCH") {
    drafts.push({
      audience: "DISPATCHER",
      type: activity.activityType,
      title: activity.activityType,
      message: activity.summary,
      relatedBookingId
    });
  }

  // Admin/Owner 预设看得到全部事件，方便整体掌握状况；未来事件一多，可以针对特定
  // module/activityType 註冊规则覆写掉（例如只挑重大事件才通知 Admin）。
  drafts.push({
    audience: "ADMIN",
    type: activity.activityType,
    title: activity.activityType,
    message: activity.summary,
    relatedBookingId
  });

  return drafts;
}

export async function handleActivity(activity: ActivityLog, client: Prisma.TransactionClient | typeof prisma) {
  const matched = rules.filter(
    (rule) => rule.module === activity.module && (!rule.activityType || rule.activityType === activity.activityType)
  );
  const drafts = matched.length > 0 ? matched.flatMap((rule) => rule.build(activity)) : defaultDrafts(activity);

  for (const draft of drafts) {
    await client.notification.create({
      data: {
        audience: draft.audience,
        driverId: draft.driverId ?? null,
        type: draft.type,
        title: draft.title,
        message: draft.message,
        relatedBookingId: draft.relatedBookingId ?? null,
        relatedUrl: draft.relatedUrl ?? null,
        sourceActivityId: activity.id
      }
    });
  }
}

subscribeToActivity(handleActivity);

// ---------------------------------------------------------------------------
// 手动建立（CRUD 的 Create）：给人用，不是给模块用。
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
  audience: NotificationAudience;
  driverId?: number | null;
  type: string;
  title: string;
  message: string;
  relatedBookingId?: number | null;
  relatedUrl?: string | null;
}

export async function createManualNotification(input: CreateNotificationInput): Promise<Notification> {
  if (input.audience === "DRIVER" && !input.driverId) {
    throw new ValidationError("driverId is required when audience is DRIVER");
  }
  if (input.audience !== "DRIVER" && input.driverId) {
    throw new ValidationError("driverId is only allowed when audience is DRIVER");
  }

  return prisma.notification.create({
    data: {
      audience: input.audience,
      driverId: input.driverId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      relatedBookingId: input.relatedBookingId ?? null,
      relatedUrl: input.relatedUrl ?? null,
      sourceActivityId: null
    }
  });
}

// ---------------------------------------------------------------------------
// CRUD：Read / Update（Read/Unread）/ Delete
// ---------------------------------------------------------------------------

export interface ListNotificationsFilters {
  audience?: NotificationAudience;
  /** 只列出这个司机自己的（driver-self 路由用）。 */
  driverId?: number;
  isRead?: boolean;
  page: number;
  pageSize: number;
}

export async function listNotifications(filters: ListNotificationsFilters) {
  const where: Prisma.NotificationWhereInput = {
    audience: filters.audience,
    driverId: filters.driverId,
    isRead: filters.isRead
  };

  const [data, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize
    }),
    prisma.notification.count({ where })
  ]);

  return { data, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getNotificationById(id: number): Promise<Notification> {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) {
    throw new NotFoundError(`Notification ${id} not found`);
  }
  return notification;
}

/** 只有司机自己的 DRIVER Notification 才能通过；找不到/不是自己的一律当 404，不泄漏存在与否。 */
export async function getOwnDriverNotification(id: number, driverId: number): Promise<Notification> {
  const notification = await prisma.notification.findFirst({
    where: { id, audience: "DRIVER", driverId }
  });
  if (!notification) {
    throw new NotFoundError(`Notification ${id} not found`);
  }
  return notification;
}

export async function markAsRead(id: number): Promise<Notification> {
  await getNotificationById(id);
  return prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
}

export async function markAsUnread(id: number): Promise<Notification> {
  await getNotificationById(id);
  return prisma.notification.update({ where: { id }, data: { isRead: false, readAt: null } });
}

export async function deleteNotification(id: number): Promise<void> {
  await getNotificationById(id);
  await prisma.notification.delete({ where: { id } });
}
