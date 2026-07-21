import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import type { RoleKey } from "./permissions.js";

/** 操作者身份，从 req.authUser 直接带过来，null 代表系统自动触发（目前没有这种情况，保留给未来）。 */
export interface AuditActor {
  id: number;
  /** 大多数情况下都知道；少数没有登入态可查的场合（例如未验证的 logout）可以省略。 */
  role?: RoleKey;
}

interface WriteAuditLogInput {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId: number;
  /** 改动前的资料快照，没有「改动」概念的建立类事件不用填。 */
  beforeData?: unknown;
  /** 改动后/建立时的资料快照。 */
  afterData?: unknown;
  /** 其他辅助资讯（原因、关联 id 等），不是 before/after 快照的东西放这里。 */
  metadata?: unknown;
}

/** 把任意值转成 Prisma Json 栏位能接受的纯 JSON 结构（Date -> ISO string 等）。 */
function toJsonSafe(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** 从 requireAuth 附加在 req 上的 authUser 取出 { id, role }，方便 controller 一行搞定。 */
export function actorFromRequest(req: Request): AuditActor | null {
  return req.authUser ? { id: req.authUser.id, role: req.authUser.role.key } : null;
}

export function writeAuditLog(input: WriteAuditLogInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.auditLog.create({
    data: {
      actorUserId: input.actor?.id ?? null,
      actorRole: input.actor?.role ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: toJsonSafe(input.beforeData),
      afterData: toJsonSafe(input.afterData),
      metadata: toJsonSafe(input.metadata)
    }
  });
}
