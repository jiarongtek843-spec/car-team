import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverPresenceController from "./driverPresence.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const driverPresenceRouter = Router();

driverPresenceRouter.use(requireAuth, requireRole("DRIVER"));

driverPresenceRouter.get("/me", asyncHandler(driverPresenceController.me));
driverPresenceRouter.post("/online", asyncHandler(driverPresenceController.goOnline));
driverPresenceRouter.post("/offline", asyncHandler(driverPresenceController.goOffline));
driverPresenceRouter.post("/ping", asyncHandler(driverPresenceController.ping));
