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
dispatchRouter.get("/legs/:legId/offers", asyncHandler(dispatchController.offersForLeg));
dispatchRouter.get("/matching/:bookingId", asyncHandler(dispatchController.matching));
// Send Offer 是实际会改变 Leg 派车状态的写入动作，跟既有 Quick Assign（bookings.routes.ts
// 的 /:id/legs/:legId/assign）用同一个 BOOKING_WRITE 门槛，而不是只要 DISPATCH_READ。
dispatchRouter.post(
  "/legs/:legId/send-offer",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(dispatchController.sendOffer)
);
