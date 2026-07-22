import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import { actorFromRequest } from "../../common/audit.js";
import * as revenueSharingService from "./revenueSharing.service.js";

const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

export async function preview(req: Request, res: Response) {
  const bookingId = parseIdParam(req.params.bookingId);
  const result = await revenueSharingService.previewRevenueSharing(bookingId);
  res.json(result);
}

export async function finalize(req: Request, res: Response) {
  const bookingId = parseIdParam(req.params.bookingId);
  const snapshot = await revenueSharingService.finalizeRevenueSharing(bookingId, actorFromRequest(req)!);
  res.status(201).json(snapshot);
}

export async function getSnapshot(req: Request, res: Response) {
  const bookingId = parseIdParam(req.params.bookingId);
  const snapshot = await revenueSharingService.getRevenueSnapshot(bookingId);
  res.json(snapshot);
}

export async function history(req: Request, res: Response) {
  const query = historyQuerySchema.parse(req.query);
  const result = await revenueSharingService.listRevenueHistory(query);
  res.json(result);
}
