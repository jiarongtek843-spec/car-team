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
// 一定要在 "/:bookingId" 之前注册，不然 Express 会把 "summary" 当成 bookingId 参数吃掉。
revenueSharingRouter.get(
  "/summary",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.commissionSummary)
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

// Module 12（Wallet Migration）：没有独立的 Issue Wallet 端点——POST /:bookingId/finalize
// 现在会在同一个 Transaction 里自动发放 Wallet（V2 Booking）。这 3 个 Wallet 相关的
// 查询沿用既有的 revenueSharing:read（Owner/Manager/Dispatcher 都能看）。
revenueSharingRouter.get(
  "/:bookingId/wallet",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.walletForBooking)
);
revenueSharingRouter.get(
  "/wallet/history",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.walletHistory)
);
revenueSharingRouter.get(
  "/wallet/by-driver/:driverId",
  requirePermission(PERMISSIONS.REVENUE_SHARING_READ),
  asyncHandler(revenueSharingController.driverWallet)
);
