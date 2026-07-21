import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as companySettingsController from "./companySettings.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const companySettingsRouter = Router();

companySettingsRouter.use(requireAuth);

companySettingsRouter.get(
  "/",
  requirePermission(PERMISSIONS.COMPANY_SETTINGS_READ),
  asyncHandler(companySettingsController.get)
);
companySettingsRouter.patch(
  "/",
  requirePermission(PERMISSIONS.COMPANY_SETTINGS_WRITE),
  asyncHandler(companySettingsController.update)
);
