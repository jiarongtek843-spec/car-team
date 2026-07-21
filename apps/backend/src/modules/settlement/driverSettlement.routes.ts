import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverSettlementController from "./driverSettlement.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverSettlementRouter = Router();

driverSettlementRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_SETTLEMENT_SELF));

driverSettlementRouter.get("/", asyncHandler(driverSettlementController.list));
