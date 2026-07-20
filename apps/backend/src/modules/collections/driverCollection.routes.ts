import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverCollectionController from "./driverCollection.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { collectionProofUpload } from "../../common/upload.js";

export const driverCollectionRouter = Router();

driverCollectionRouter.use(requireAuth, requireRole("DRIVER"));

driverCollectionRouter.post("/", asyncHandler(driverCollectionController.create));
driverCollectionRouter.get("/", asyncHandler(driverCollectionController.list));
driverCollectionRouter.get("/:id", asyncHandler(driverCollectionController.getOne));
driverCollectionRouter.post(
  "/:id/proof-image",
  collectionProofUpload.single("file"),
  asyncHandler(driverCollectionController.uploadProof)
);
