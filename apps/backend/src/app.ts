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
import { bookingChargeRouter } from "./modules/bookingCharges/bookingCharge.routes.js";
import { revenueSharingRouter } from "./modules/revenueSharing/revenueSharing.routes.js";
import { notificationRouter } from "./modules/notifications/notification.routes.js";
import { driverNotificationRouter } from "./modules/notifications/driverNotification.routes.js";
import { errorHandler } from "./common/errorHandler.js";
import { requireAuth } from "./modules/auth/auth.middleware.js";
import { asyncHandler } from "./common/asyncHandler.js";
import * as collectionController from "./modules/collections/collection.controller.js";

export const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);

// Mobile UAT Bug Fix（Driver Online 状态同步）：这个 API 底下每一支 GET 都是 Session/
// Driver 专属的即时资料（presence、wallet、booking 状态……），没有任何一支是可以被浏览器
// 或中间的网络设备快取的。实测发现 iOS Safari 在「POST /online 成功后，react-query
// 立刻发出的 GET /driver/presence/me」这个情境下，即使 Server 完全没送 Cache-Control，
// 还是会用自己 HTTP cache 里那份『上线前』的旧回应打发，造成 Toast 显示已上线、但
// Header/首页 Switch 两边读到的还是旧状态。明确送 `Cache-Control: no-store` 是唯一能
// 保证浏览器/中间代理都不会快取的做法，跟 Frontend 那份 `fetch(..., {cache:"no-store"})`
// 是同一个修复的两端（Frontend 控制自己怎么发请求，这里保证 Server 回应本身也明确声明
// 不可快取，两层缺一层都可能在某些浏览器/网络环境下失效）。
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Mobile UAT Bug Fix：Collection Proof 图片之前是靠 express.static 完全公开挂在 /uploads——
// 任何登入、甚至没登入的人只要猜得到档名就能看到任何 Driver 的代收凭证。改成一支要求
// requireAuth、并在 collectionService.getCollectionProofFilePath 里逐笔核对「呼叫者是不是
// 这笔 Collection 本人 Driver 或有 collection:read 权限的 Admin」的路由，不再是公开静态目录。
// 挂在 /api/uploads/...（不是 /uploads/...）是刻意的：Railway 上 Frontend 只反向代理
// /api/* 给 Backend（见 apps/frontend/server.js），挂在 /api 底下才能透过同源代理被
// Safari/浏览器正常请求到，不需要另外再帮 /uploads 加一条代理规则。
app.get("/api/uploads/collections/:filename", requireAuth, asyncHandler(collectionController.serveProof));

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
app.use("/api/admin/booking-charges", bookingChargeRouter);
app.use("/api/admin/revenue-sharing", revenueSharingRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/driver/notifications", driverNotificationRouter);

app.use(errorHandler);
