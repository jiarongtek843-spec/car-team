import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driversController from "./drivers.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const driversRouter = Router();

driversRouter.use(requireAuth, requireRole("ADMIN"));

driversRouter.get("/", asyncHandler(driversController.list));
driversRouter.post("/", asyncHandler(driversController.create));
driversRouter.patch("/:id", asyncHandler(driversController.update));
driversRouter.post("/:id/status", asyncHandler(driversController.setStatus));
driversRouter.post("/:id/reset-password", asyncHandler(driversController.resetPassword));
