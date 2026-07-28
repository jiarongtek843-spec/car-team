import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as dispatchController from "./dispatch.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth, requirePermission(PERMISSIONS.DISPATCH_READ));

dispatchRouter.get("/waiting-bookings", asyncHandler(dispatchController.waitingBookings));
dispatchRouter.get("/drivers", asyncHandler(dispatchController.drivers));
dispatchRouter.get("/statistics", asyncHandler(dispatchController.statistics));
dispatchRouter.get("/legs/:legId/suggested-drivers", asyncHandler(dispatchController.suggestedDrivers));
