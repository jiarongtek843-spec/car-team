import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverWalletController from "./driverWallet.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverWalletRouter = Router();

driverWalletRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_WALLET_SELF));

driverWalletRouter.get("/summary", asyncHandler(driverWalletController.summary));
driverWalletRouter.get("/transactions", asyncHandler(driverWalletController.transactions));
