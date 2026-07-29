import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as notificationService from "./notification.service.js";

const audienceSchema = z.enum(["DRIVER", "DISPATCHER", "ADMIN"]);

const listQuerySchema = z.object({
  audience: audienceSchema.optional(),
  isRead: z.coerce.boolean().optional(),
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
