import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors.js";

// 只记 method/path/status/message，刻意不碰 req.body/req.headers——登入失败(401)这类错误
// 的 req.body 会带明文密码，绝对不能连带记进 Railway Logs。errorHandler 本身拿不到已经
// 通过身份验证的 session 使用者是谁（有些错误在 requireAuth 之前就发生），所以也不额外
// 记 actor，避免混进不完整/误导的资變。
function logApiError(req: Request, statusCode: number, message: string) {
  const level = statusCode === 401 ? "AUTH_ERROR" : "API_ERROR";
  console.warn(`[${level}] ${statusCode} ${req.method} ${req.originalUrl} — ${message}`);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logApiError(req, err.statusCode, err.message);
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    logApiError(req, 400, "Invalid request");
    res.status(400).json({ error: "Invalid request", details: err.flatten() });
    return;
  }

  if (err instanceof multer.MulterError) {
    logApiError(req, 400, err.message);
    res.status(400).json({ error: err.message });
    return;
  }

  // Stabilization: 一般化的 Prisma 错误翻译——大部分 service 都没有针对每个 unique/FK
  // constraint 各自写 try/catch（少数像 drivers.service.ts 手动检查 P2002 的是例外），
  // 没接住的话会直接落到下面的 500。这里接住三个最常见、可以给出明确讯息的错误码，
  // 不代表要取代 service 层该做的业务验证——只是把「本来会变成不明 500」的情况变成
  // 有意义的 4xx，讯息刻意不附带 Prisma 的 meta 细节（可能包含栏位名以外的内部资讯）。
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      logApiError(req, 409, "Duplicate value conflicts with an existing record");
      res.status(409).json({ error: "Duplicate value conflicts with an existing record" });
      return;
    }
    if (err.code === "P2003") {
      logApiError(req, 400, "Referenced record does not exist");
      res.status(400).json({ error: "Referenced record does not exist" });
      return;
    }
    if (err.code === "P2025") {
      logApiError(req, 404, "Record not found");
      res.status(404).json({ error: "Record not found" });
      return;
    }
  }

  console.error(`[UNHANDLED_EXCEPTION] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: "Internal server error" });
}
