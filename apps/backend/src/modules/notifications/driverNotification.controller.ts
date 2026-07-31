import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import { parseIdParam } from "../../common/params.js";
import * as notificationService from "./notification.service.js";

// z.coerce.boolean() 对字串一律用 JS 的 Boolean() 转换——非空字串永远是 truthy，
// 所以查询字串 isRead=false 会被转成 true，isRead=false 这个过滤条件实际上完全用不了
// （永远查到已读的，不是未读的）。要正确处理 "true"/"false" 字面字串，只能自己转换。
const isReadParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

const listQuerySchema = z.object({
  isRead: isReadParam,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function list(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const query = listQuerySchema.parse(req.query);
  const result = await notificationService.listNotifications({ ...query, audience: "DRIVER", driverId });
  res.json(result);
}

export async function markRead(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const id = parseIdParam(req.params.id);
  await notificationService.getOwnDriverNotification(id, driverId);
  const notification = await notificationService.markAsRead(id);
  res.json(notification);
}

export async function markUnread(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const id = parseIdParam(req.params.id);
  await notificationService.getOwnDriverNotification(id, driverId);
  const notification = await notificationService.markAsUnread(id);
  res.json(notification);
}
