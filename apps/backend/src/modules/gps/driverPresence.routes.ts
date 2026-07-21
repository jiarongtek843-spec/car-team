import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverPresenceController from "./driverPresence.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverPresenceRouter = Router();

driverPresenceRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_PRESENCE_SELF));

driverPresenceRouter.get("/me", asyncHandler(driverPresenceController.me));
driverPresenceRouter.post("/online", asyncHandler(driverPresenceController.goOnline));
driverPresenceRouter.post("/offline", asyncHandler(driverPresenceController.goOffline));
driverPresenceRouter.post("/ping", asyncHandler(driverPresenceController.ping));
