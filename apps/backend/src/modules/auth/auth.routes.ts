import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import * as authController from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import { loginRateLimiter } from "../../common/rateLimit.js";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, asyncHandler(authController.login));
authRouter.post("/logout", asyncHandler(authController.logout));
authRouter.get("/me", requireAuth, asyncHandler(authController.me));
authRouter.patch("/me", requireAuth, asyncHandler(authController.updateMe));
