import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import multer from "multer";
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

  console.error(`[UNHANDLED_EXCEPTION] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: "Internal server error" });
}
