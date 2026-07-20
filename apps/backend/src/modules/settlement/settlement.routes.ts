import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as settlementController from "./settlement.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const settlementRouter = Router();

settlementRouter.use(requireAuth, requireRole("ADMIN"));

settlementRouter.get("/preview", asyncHandler(settlementController.preview));
settlementRouter.post("/", asyncHandler(settlementController.confirm));
settlementRouter.get("/", asyncHandler(settlementController.list));
settlementRouter.get("/:id", asyncHandler(settlementController.getOne));
settlementRouter.post("/:id/void", asyncHandler(settlementController.voidOne));
