import { app } from "./app.js";
import { env } from "./config/env.js";
import { sweepExpiredOffers } from "./modules/dispatch/dispatchOffer.service.js";

// express 的 errorHandler 只能接住「请求处理过程中」的错误；这两个是最后一道防线，接住
// express 生命周期之外发生的例外（例如某个 async 呼叫忘记 await、背景任务丢出的例外），
// 让它们至少留下一条 log 而不是让 process 无声退出——不 process.exit，让 Railway 的
// restartPolicy（railway.json 的 ON_FAILURE）决定要不要重启，这里只负责记录。
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
});

app.listen(env.port, () => {
  console.log(`[STARTUP] Backend listening on port ${env.port} (APP_ENV=${env.appEnv})`);
});

// Phase 1 Dispatch Engine 的逾时 Sweep——每 10 秒把过期的 PENDING Offer 标成 EXPIRED。
// 纯粹是状态记录，不触发任何自动重新派车，Leg 本来就还留在 Waiting Bookings 名单里。
setInterval(() => {
  sweepExpiredOffers().catch((err) => {
    console.error("[DISPATCH_OFFER_SWEEP_FAILED]", err);
  });
}, 10_000);
