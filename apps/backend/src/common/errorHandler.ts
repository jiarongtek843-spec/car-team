import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: err.flatten() });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
