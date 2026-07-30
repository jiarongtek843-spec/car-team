import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverPresenceController from "./driverPresence.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverPresenceRouter = Router();

// Driver Status 区块显示在 Dispatch 页面，跟 Dispatch Center 本身共用同一个 Permission
// （dispatch:read）——不为了一个显示用的 Read Only 端点另外新增一把 Key。
driverPresenceRouter.use(requireAuth, requirePermission(PERMISSIONS.DISPATCH_READ));

driverPresenceRouter.get("/", asyncHandler(driverPresenceController.list));
