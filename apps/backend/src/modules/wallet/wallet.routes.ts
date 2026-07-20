import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as walletController from "./wallet.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const walletRouter = Router();

walletRouter.use(requireAuth, requireRole("ADMIN"));

walletRouter.get("/transactions", asyncHandler(walletController.transactions));
walletRouter.get("/unsettled-by-driver", asyncHandler(walletController.unsettledByDriver));
walletRouter.post("/adjustments", asyncHandler(walletController.createManualAdjustment));
walletRouter.post("/settlement-adjustments", asyncHandler(walletController.createSettlementAdjustment));
