import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import { actorFromRequest } from "../../common/audit.js";
import * as bookingChargeService from "./bookingCharge.service.js";

const createSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  legId: z.coerce.number().int().positive().optional(),
  chargeTypeId: z.coerce.number().int().positive(),
  amountCents: z.coerce.number().int(),
  description: z.string().trim().max(500).optional(),
  adjustsChargeId: z.coerce.number().int().positive().optional(),
  adjustmentReason: z.string().trim().max(500).optional()
});

const voidSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

const listQuerySchema = z.object({
  bookingId: z.coerce.number().int().positive()
});

export async function create(req: Request, res: Response) {
  const input = createSchema.parse(req.body);
  const charge = await bookingChargeService.createBookingCharge(input, actorFromRequest(req)!);
  res.status(201).json(charge);
}

export async function list(req: Request, res: Response) {
  const { bookingId } = listQuerySchema.parse(req.query);
  const charges = await bookingChargeService.listBookingCharges(bookingId);
  res.json(charges);
}

export async function getOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const charge = await bookingChargeService.getBookingCharge(id);
  res.json(charge);
}

export async function voidOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { reason } = voidSchema.parse(req.body);
  const reversal = await bookingChargeService.voidBookingCharge(id, { reason }, actorFromRequest(req)!);
  res.status(201).json(reversal);
}

export async function history(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const rows = await bookingChargeService.getChargeHistory(id);
  res.json(rows);
}
