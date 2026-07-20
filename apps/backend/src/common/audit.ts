import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

interface WriteAuditLogInput {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: number;
  metadata?: Prisma.InputJsonValue;
}

export function writeAuditLog(input: WriteAuditLogInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata
    }
  });
}
