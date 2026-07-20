import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as gpsController from "./gps.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const gpsRouter = Router();

gpsRouter.use(requireAuth, requireRole("ADMIN"));

gpsRouter.get("/drivers", asyncHandler(gpsController.list));
gpsRouter.get("/drivers/:driverId", asyncHandler(gpsController.getOne));
