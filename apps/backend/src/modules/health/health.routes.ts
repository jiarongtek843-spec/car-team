import { Router } from "express";
import { prisma } from "../../config/prisma.js";

export const healthRouter = Router();

// Railway 的 Healthcheck（railway.json 的 healthcheckPath）跟人工排查都打这支：
// Database 连不上时回 503，让 Railway 判定这次部署没有真的可用，不要把流量切过去；
// 只回 status，不回任何连线字串/错误堆疊，避免把 DB 连线细节暴露在公开的健康检查回应里。
healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", database: "unreachable", timestamp: new Date().toISOString() });
  }
});
