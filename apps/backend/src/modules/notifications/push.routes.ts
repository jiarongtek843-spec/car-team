import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as pushController from "./push.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const pushRouter = Router();

pushRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_NOTIFICATION_SELF));

pushRouter.get("/vapid-public-key", asyncHandler(pushController.getVapidPublicKey));
pushRouter.post("/subscribe", asyncHandler(pushController.subscribe));
pushRouter.post("/unsubscribe", asyncHandler(pushController.unsubscribe));
