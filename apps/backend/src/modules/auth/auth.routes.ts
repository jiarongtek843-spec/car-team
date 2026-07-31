import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as authController from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(authController.login));
authRouter.post("/logout", asyncHandler(authController.logout));
authRouter.get("/me", requireAuth, asyncHandler(authController.me));
authRouter.patch("/me", requireAuth, asyncHandler(authController.updateMe));
