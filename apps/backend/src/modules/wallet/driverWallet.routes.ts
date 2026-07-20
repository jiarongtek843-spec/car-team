import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverWalletController from "./driverWallet.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const driverWalletRouter = Router();

driverWalletRouter.use(requireAuth, requireRole("DRIVER"));

driverWalletRouter.get("/summary", asyncHandler(driverWalletController.summary));
driverWalletRouter.get("/transactions", asyncHandler(driverWalletController.transactions));
