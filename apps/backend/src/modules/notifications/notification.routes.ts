import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as notificationController from "./notification.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get("/", requirePermission(PERMISSIONS.NOTIFICATION_READ), asyncHandler(notificationController.list));
notificationRouter.post("/", requirePermission(PERMISSIONS.NOTIFICATION_WRITE), asyncHandler(notificationController.create));
notificationRouter.get("/:id", requirePermission(PERMISSIONS.NOTIFICATION_READ), asyncHandler(notificationController.getOne));
notificationRouter.patch(
  "/:id/read",
  requirePermission(PERMISSIONS.NOTIFICATION_READ),
  asyncHandler(notificationController.markRead)
);
notificationRouter.patch(
  "/:id/unread",
  requirePermission(PERMISSIONS.NOTIFICATION_READ),
  asyncHandler(notificationController.markUnread)
);
notificationRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.NOTIFICATION_WRITE),
  asyncHandler(notificationController.remove)
);
