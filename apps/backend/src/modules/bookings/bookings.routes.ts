import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as bookingsController from "./bookings.controller.js";
import * as legsController from "./legs.controller.js";

export const bookingsRouter = Router();

bookingsRouter.get("/", asyncHandler(bookingsController.list));
bookingsRouter.post("/", asyncHandler(bookingsController.create));
bookingsRouter.get("/:id", asyncHandler(bookingsController.getOne));
bookingsRouter.patch("/:id", asyncHandler(bookingsController.update));
bookingsRouter.post("/:id/cancel", asyncHandler(bookingsController.cancel));

bookingsRouter.post("/:id/legs", asyncHandler(legsController.add));
bookingsRouter.patch("/:id/legs/:legId", asyncHandler(legsController.update));
bookingsRouter.post("/:id/legs/:legId/assign", asyncHandler(legsController.assign));
bookingsRouter.post("/:id/legs/:legId/start", asyncHandler(legsController.start));
bookingsRouter.post("/:id/legs/:legId/complete", asyncHandler(legsController.complete));
bookingsRouter.post("/:id/legs/:legId/cancel", asyncHandler(legsController.cancel));
bookingsRouter.delete("/:id/legs/:legId", asyncHandler(legsController.remove));
