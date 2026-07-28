import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driverJobsController from "./driverJobs.controller.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

export const driverJobsRouter = Router();

driverJobsRouter.use(requireAuth, requirePermission(PERMISSIONS.DRIVER_JOBS_SELF));

driverJobsRouter.get("/", asyncHandler(driverJobsController.list));
driverJobsRouter.get("/offers", asyncHandler(driverJobsController.myOffers));
driverJobsRouter.post("/offers/:offerId/accept", asyncHandler(driverJobsController.acceptOffer));
driverJobsRouter.post("/offers/:offerId/decline", asyncHandler(driverJobsController.declineOffer));
driverJobsRouter.post("/:legId/accept", asyncHandler(driverJobsController.accept));
driverJobsRouter.post("/:legId/reject", asyncHandler(driverJobsController.reject));
driverJobsRouter.post("/:legId/arriving", asyncHandler(driverJobsController.arriving));
driverJobsRouter.post("/:legId/on-board", asyncHandler(driverJobsController.onBoard));
driverJobsRouter.post("/:legId/complete", asyncHandler(driverJobsController.complete));
