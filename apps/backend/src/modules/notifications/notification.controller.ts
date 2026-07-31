import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as notificationService from "./notification.service.js";

const audienceSchema = z.enum(["DRIVER", "DISPATCHER", "ADMIN"]);

// z.coerce.boolean() 对字串一律用 JS 的 Boolean() 转换——非空字串永远是 truthy，
// 所以查询字串 isRead=false 会被转成 true，isRead=false 这个过滤条件实际上完全用不了
// （永远查到已读的，不是未读的）。要正确处理 "true"/"false" 字面字串，只能自己转换。
const isReadParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

const listQuerySchema = z.object({
  audience: audienceSchema.optional(),
  isRead: isReadParam,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

const createSchema = z.object({
  audience: audienceSchema,
  driverId: z.coerce.number().int().positive().optional(),
  type: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  relatedBookingId: z.coerce.number().int().positive().optional(),
  relatedUrl: z.string().min(1).optional()
});

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const result = await notificationService.listNotifications(query);
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const notification = await notificationService.getNotificationById(id);
  res.json(notification);
}

export async function create(req: Request, res: Response) {
  const input = createSchema.parse(req.body);
  const notification = await notificationService.createManualNotification(input);
  res.status(201).json(notification);
}

export async function markRead(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const notification = await notificationService.markAsRead(id);
  res.json(notification);
}

export async function markUnread(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const notification = await notificationService.markAsUnread(id);
  res.json(notification);
}

export async function remove(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  await notificationService.deleteNotification(id);
  res.status(204).end();
}
