import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as collectionController from "./collection.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const collectionRouter = Router();

collectionRouter.use(requireAuth);

collectionRouter.get("/", requirePermission(PERMISSIONS.COLLECTION_READ), asyncHandler(collectionController.list));
collectionRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.COLLECTION_READ),
  asyncHandler(collectionController.getOne)
);
collectionRouter.post(
  "/:id/verify",
  requirePermission(PERMISSIONS.COLLECTION_WRITE),
  asyncHandler(collectionController.verify)
);
collectionRouter.post(
  "/:id/void",
  requirePermission(PERMISSIONS.COLLECTION_WRITE),
  asyncHandler(collectionController.voidOne)
);
