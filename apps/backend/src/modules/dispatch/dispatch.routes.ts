import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as dispatchController from "./dispatch.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth, requireRole("ADMIN"));

dispatchRouter.get("/waiting-bookings", asyncHandler(dispatchController.waitingBookings));
dispatchRouter.get("/drivers", asyncHandler(dispatchController.drivers));
dispatchRouter.get("/statistics", asyncHandler(dispatchController.statistics));
