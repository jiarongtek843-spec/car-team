import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as driversController from "./drivers.controller.js";

export const driversRouter = Router();

driversRouter.get("/", asyncHandler(driversController.list));
driversRouter.post("/", asyncHandler(driversController.create));
