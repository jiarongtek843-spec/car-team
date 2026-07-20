import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { bookingsRouter } from "./modules/bookings/bookings.routes.js";
import { driversRouter } from "./modules/drivers/drivers.routes.js";
import { errorHandler } from "./common/errorHandler.js";

export const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/drivers", driversRouter);

app.use(errorHandler);
