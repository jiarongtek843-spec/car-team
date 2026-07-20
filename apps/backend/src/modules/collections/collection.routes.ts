import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as collectionController from "./collection.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const collectionRouter = Router();

collectionRouter.use(requireAuth, requireRole("ADMIN"));

collectionRouter.get("/", asyncHandler(collectionController.list));
collectionRouter.get("/:id", asyncHandler(collectionController.getOne));
collectionRouter.post("/:id/verify", asyncHandler(collectionController.verify));
collectionRouter.post("/:id/void", asyncHandler(collectionController.voidOne));
