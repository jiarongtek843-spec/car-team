import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as bookingsController from "./bookings.controller.js";
import * as legsController from "./legs.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);

bookingsRouter.get("/", requirePermission(PERMISSIONS.BOOKING_READ), asyncHandler(bookingsController.list));
bookingsRouter.post("/", requirePermission(PERMISSIONS.BOOKING_WRITE), asyncHandler(bookingsController.create));
bookingsRouter.get("/:id", requirePermission(PERMISSIONS.BOOKING_READ), asyncHandler(bookingsController.getOne));
bookingsRouter.patch("/:id", requirePermission(PERMISSIONS.BOOKING_WRITE), asyncHandler(bookingsController.update));
bookingsRouter.post(
  "/:id/cancel",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(bookingsController.cancel)
);

bookingsRouter.post("/:id/legs", requirePermission(PERMISSIONS.BOOKING_WRITE), asyncHandler(legsController.add));
bookingsRouter.patch(
  "/:id/legs/:legId",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(legsController.update)
);
bookingsRouter.post(
  "/:id/legs/:legId/assign",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(legsController.assign)
);
bookingsRouter.post(
  "/:id/legs/:legId/cancel",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(legsController.cancel)
);
bookingsRouter.delete(
  "/:id/legs/:legId",
  requirePermission(PERMISSIONS.BOOKING_WRITE),
  asyncHandler(legsController.remove)
);
