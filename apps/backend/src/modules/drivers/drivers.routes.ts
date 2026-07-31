import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driversController from "./drivers.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driversRouter = Router();

driversRouter.use(requireAuth);

driversRouter.get("/", requirePermission(PERMISSIONS.DRIVER_READ), asyncHandler(driversController.list));
driversRouter.post("/", requirePermission(PERMISSIONS.DRIVER_WRITE), asyncHandler(driversController.create));
driversRouter.patch("/:id", requirePermission(PERMISSIONS.DRIVER_WRITE), asyncHandler(driversController.update));
driversRouter.post(
  "/:id/status",
  requirePermission(PERMISSIONS.DRIVER_WRITE),
  asyncHandler(driversController.setStatus)
);
driversRouter.post(
  "/:id/reset-password",
  requirePermission(PERMISSIONS.DRIVER_WRITE),
  asyncHandler(driversController.resetPassword)
);
driversRouter.delete("/:id", requirePermission(PERMISSIONS.DRIVER_WRITE), asyncHandler(driversController.remove));
