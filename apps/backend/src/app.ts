import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { sessionMiddleware } from "./config/session.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { bookingsRouter } from "./modules/bookings/bookings.routes.js";
import { driversRouter } from "./modules/drivers/drivers.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { driverJobsRouter } from "./modules/driverJobs/driverJobs.routes.js";
import { errorHandler } from "./common/errorHandler.js";

export const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/driver/legs", driverJobsRouter);

app.use(errorHandler);
