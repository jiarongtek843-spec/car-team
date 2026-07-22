import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as revenueSharingController from "./revenueSharing.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const revenueSharingRouter = Router();

revenueSharingRouter.use(requireAuth);

revenueSharingRouter.get(
  "/",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.history)
);
revenueSharingRouter.get(
  "/:bookingId",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.getSnapshot)
);
revenueSharingRouter.post(
  "/:bookingId/preview",
  requirePermission(PERMISSIONS.REVENUE_SHARING_PREVIEW),
  asyncHandler(revenueSharingController.preview)
);
revenueSharingRouter.post(
  "/:bookingId/finalize",
  requirePermission(PERMISSIONS.REVENUE_SHARING_FINALIZE),
  asyncHandler(revenueSharingController.finalize)
);
