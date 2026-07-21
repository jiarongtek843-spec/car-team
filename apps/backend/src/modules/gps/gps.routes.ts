import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as gpsController from "./gps.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const gpsRouter = Router();

gpsRouter.use(requireAuth, requirePermission(PERMISSIONS.GPS_READ));

gpsRouter.get("/drivers", asyncHandler(gpsController.list));
gpsRouter.get("/drivers/:driverId", asyncHandler(gpsController.getOne));
