import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import { parseIdParam } from "../../common/params.js";
import * as notificationService from "./notification.service.js";

const listQuerySchema = z.object({
  isRead: z.coerce.boolean().optional(),
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
