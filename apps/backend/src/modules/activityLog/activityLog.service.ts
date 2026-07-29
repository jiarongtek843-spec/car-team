import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/**
 * Activity Log（2026-07，标准化基础设施）：给未来的 Notification Center 以及 Wallet/GPS/
 * Dispatch/Settlement/Finance/Admin 等模块共用的通用事件记录入口。见 schema.prisma 的
 * ActivityLog model 注解——跟 AuditLog（common/audit.ts）是两回事，不要混用：AuditLog 记
 * 「改动前后」，ActivityLog 记「发生了什么事、可能要通知谁」。
 *
 * 这一版刻意只做「写」，不做「读」：还没有任何 Consumer（Notification Center 尚未开工），
 * 现在先设计查询介面只会是纯猜测。等真的要接 Notification Center 时，用哪些栏位查、要不要
 * 分页/已读状态，届时才会明朗。
 */

/** 谁触发了这个事件。省略代表系统自动触发（例如自动分润、GPS 自动判定离线）。 */
export interface ActivityActor {
  userId?: number;
  driverId?: number;
}

export interface CreateActivityInput {
  /** 事件属于哪个模块，例如 "BOOKING" | "DISPATCH" | "WALLET" | "GPS" | "SETTLEMENT"。纯字串，方便新模块直接接用不用改 schema。 */
  module: string;
  /** 具体事件类型，例如 "BOOKING_CREATED" | "DRIVER_ACCEPTED_LEG"。纯字串，理由同上。 */
  activityType: string;
  /** 这个事件所属的实体，例如 "Booking" / "Leg" / "WalletTransaction"。 */
  entityType: string;
  entityId: number;
  /** 一句人看得懂的描述，未来 Notification Center 可以直接拿去显示。 */
  summary: string;
  /** 触发者；省略代表系统自动触发。 */
  actor?: ActivityActor;
  /** 这件事跟哪个司机有关（不一定等于 actor.driverId，例如 Dispatcher 帮司机送 Offer）。未来 Notification Center 用这个决定推给谁。 */
  subjectDriverId?: number;
  /** 结构化补充资料，供未来渲染用（金额、关联 id 等），不是必要栏位。 */
  metadata?: unknown;
}

function toJsonSafe(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function createActivity(
  input: CreateActivityInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  return client.activityLog.create({
    data: {
      module: input.module,
      activityType: input.activityType,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      actorUserId: input.actor?.userId ?? null,
      actorDriverId: input.actor?.driverId ?? null,
      subjectDriverId: input.subjectDriverId ?? null,
      metadata: toJsonSafe(input.metadata)
    }
  });
}
