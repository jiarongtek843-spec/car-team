import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverJobsController from "./driverJobs.controller.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

export const driverJobsRouter = Router();

driverJobsRouter.use(requireAuth, requireRole("DRIVER"));

driverJobsRouter.get("/", asyncHandler(driverJobsController.list));
driverJobsRouter.post("/:legId/accept", asyncHandler(driverJobsController.accept));
driverJobsRouter.post("/:legId/reject", asyncHandler(driverJobsController.reject));
driverJobsRouter.post("/:legId/arriving", asyncHandler(driverJobsController.arriving));
driverJobsRouter.post("/:legId/on-board", asyncHandler(driverJobsController.onBoard));
driverJobsRouter.post("/:legId/complete", asyncHandler(driverJobsController.complete));
