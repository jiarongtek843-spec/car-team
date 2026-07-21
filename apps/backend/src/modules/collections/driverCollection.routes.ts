import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverCollectionController from "./driverCollection.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { collectionProofUpload } from "../../common/upload.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverCollectionRouter = Router();

driverCollectionRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_COLLECTION_SELF));

driverCollectionRouter.post("/", asyncHandler(driverCollectionController.create));
driverCollectionRouter.get("/", asyncHandler(driverCollectionController.list));
driverCollectionRouter.get("/:id", asyncHandler(driverCollectionController.getOne));
driverCollectionRouter.post(
  "/:id/proof-image",
  ...collectionProofUpload(),
  asyncHandler(driverCollectionController.uploadProof)
);
