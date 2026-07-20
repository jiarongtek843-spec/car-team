import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as companySettingsController from "./companySettings.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const companySettingsRouter = Router();

companySettingsRouter.use(requireAuth, requireRole("ADMIN"));

companySettingsRouter.get("/", asyncHandler(companySettingsController.get));
companySettingsRouter.patch("/", asyncHandler(companySettingsController.update));
