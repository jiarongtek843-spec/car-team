import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as settlementController from "./settlement.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const settlementRouter = Router();

settlementRouter.use(requireAuth);

settlementRouter.get(
  "/preview",
  requirePermission(PERMISSIONS.SETTLEMENT_READ),
  asyncHandler(settlementController.preview)
);
settlementRouter.post("/", requirePermission(PERMISSIONS.SETTLEMENT_WRITE), asyncHandler(settlementController.confirm));
settlementRouter.get("/", requirePermission(PERMISSIONS.SETTLEMENT_READ), asyncHandler(settlementController.list));
settlementRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.SETTLEMENT_READ),
  asyncHandler(settlementController.getOne)
);
settlementRouter.post(
  "/:id/void",
  requirePermission(PERMISSIONS.SETTLEMENT_WRITE),
  asyncHandler(settlementController.voidOne)
);
