import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { sessionMiddleware } from "./config/session.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { bookingsRouter } from "./modules/bookings/bookings.routes.js";
import { driversRouter } from "./modules/drivers/drivers.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { driverJobsRouter } from "./modules/driverJobs/driverJobs.routes.js";
import { companySettingsRouter } from "./modules/companySettings/companySettings.routes.js";
import { walletRouter } from "./modules/wallet/wallet.routes.js";
import { driverWalletRouter } from "./modules/wallet/driverWallet.routes.js";
import { settlementRouter } from "./modules/settlement/settlement.routes.js";
import { driverSettlementRouter } from "./modules/settlement/driverSettlement.routes.js";
import { collectionRouter } from "./modules/collections/collection.routes.js";
import { driverCollectionRouter } from "./modules/collections/driverCollection.routes.js";
import { gpsRouter } from "./modules/gps/gps.routes.js";
import { driverPresenceRouter } from "./modules/gps/driverPresence.routes.js";
import { dispatchRouter } from "./modules/dispatch/dispatch.routes.js";
import { errorHandler } from "./common/errorHandler.js";
import { uploadsRoot } from "./common/upload.js";

export const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);
// nosniff：就算未来哪个副档名判断出错、存进去一个内容跟副档名对不上的档案，也不让浏览器
// 用内容猜测（MIME sniffing）的方式把它当成 HTML/JS 执行，只信 Content-Type header 宣告的类型。
app.use(
  "/uploads",
  express.static(uploadsRoot, {
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff")
  })
);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/driver/legs", driverJobsRouter);
app.use("/api/admin/company-settings", companySettingsRouter);
app.use("/api/admin/wallet", walletRouter);
app.use("/api/driver/wallet", driverWalletRouter);
app.use("/api/admin/settlements", settlementRouter);
app.use("/api/driver/settlements", driverSettlementRouter);
app.use("/api/admin/collections", collectionRouter);
app.use("/api/driver/collections", driverCollectionRouter);
app.use("/api/admin/gps", gpsRouter);
app.use("/api/driver/presence", driverPresenceRouter);
app.use("/api/admin/dispatch", dispatchRouter);

app.use(errorHandler);
