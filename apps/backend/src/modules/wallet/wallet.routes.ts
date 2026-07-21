import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as walletController from "./wallet.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const walletRouter = Router();

walletRouter.use(requireAuth);

walletRouter.get(
  "/transactions",
  requirePermission(PERMISSIONS.WALLET_READ),
  asyncHandler(walletController.transactions)
);
walletRouter.get(
  "/unsettled-by-driver",
  requirePermission(PERMISSIONS.WALLET_READ),
  asyncHandler(walletController.unsettledByDriver)
);
walletRouter.post(
  "/adjustments",
  requirePermission(PERMISSIONS.WALLET_WRITE),
  asyncHandler(walletController.createManualAdjustment)
);
walletRouter.post(
  "/settlement-adjustments",
  requirePermission(PERMISSIONS.WALLET_WRITE),
  asyncHandler(walletController.createSettlementAdjustment)
);
