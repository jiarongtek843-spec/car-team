import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverNotificationController from "./driverNotification.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverNotificationRouter = Router();

driverNotificationRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_NOTIFICATION_SELF));

driverNotificationRouter.get("/", asyncHandler(driverNotificationController.list));
driverNotificationRouter.patch("/:id/read", asyncHandler(driverNotificationController.markRead));
driverNotificationRouter.patch("/:id/unread", asyncHandler(driverNotificationController.markUnread));
