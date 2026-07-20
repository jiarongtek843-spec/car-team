import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverSettlementController from "./driverSettlement.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const driverSettlementRouter = Router();

driverSettlementRouter.use(requireAuth, requireRole("DRIVER"));

driverSettlementRouter.get("/", asyncHandler(driverSettlementController.list));
