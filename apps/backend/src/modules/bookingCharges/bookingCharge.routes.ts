import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as bookingChargeController from "./bookingCharge.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const bookingChargeRouter = Router();

bookingChargeRouter.use(requireAuth);

bookingChargeRouter.post(
  "/",
  requirePermission(PERMISSIONS.BOOKING_CHARGE_WRITE),
  asyncHandler(bookingChargeController.create)
);
bookingChargeRouter.get(
  "/",
  requirePermission(PERMISSIONS.BOOKING_CHARGE_READ),
  asyncHandler(bookingChargeController.list)
);
bookingChargeRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.BOOKING_CHARGE_READ),
  asyncHandler(bookingChargeController.getOne)
);
bookingChargeRouter.get(
  "/:id/history",
  requirePermission(PERMISSIONS.BOOKING_CHARGE_READ),
  asyncHandler(bookingChargeController.history)
);
bookingChargeRouter.post(
  "/:id/void",
  requirePermission(PERMISSIONS.BOOKING_CHARGE_VOID),
  asyncHandler(bookingChargeController.voidOne)
);
