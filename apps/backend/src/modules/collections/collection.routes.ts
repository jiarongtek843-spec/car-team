import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as collectionController from "./collection.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const collectionRouter = Router();

collectionRouter.use(requireAuth);

collectionRouter.get("/", requirePermission(PERMISSIONS.COLLECTION_READ), asyncHandler(collectionController.list));
// 一定要在 "/:id" 之前注册，不然 Express 会把 "summary" 当成 id 参数吃掉。
collectionRouter.get(
  "/summary",
  requirePermission(PERMISSIONS.COLLECTION_READ),
  asyncHandler(collectionController.summary)
);
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
