import type { Request, Response } from "express";
import { z } from "zod";
import * as walletService from "./wallet.service.js";
import { actorFromRequest } from "../../common/audit.js";

const statusSchema = z.enum(["PENDING", "SETTLED", "VOIDED"]);

const listQuerySchema = z.object({
  driverId: z.coerce.number().int().positive().optional(),
  status: statusSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

const createAdjustmentSchema = z.object({
  driverId: z.coerce.number().int().positive(),
  amountCents: z.coerce.number().int().refine((v) => v !== 0, "Amount cannot be zero"),
  reason: z.string().min(1),
  effectiveDate: z.string().min(1)
});

const createSettlementAdjustmentSchema = createAdjustmentSchema.extend({
  relatedSettlementId: z.coerce.number().int().positive().optional()
});

export async function transactions(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const result = await walletService.listTransactions(query);
  res.json(result);
}

export async function unsettledByDriver(_req: Request, res: Response) {
  const result = await walletService.getUnsettledByDriver();
  res.json(result);
}

export async function createManualAdjustment(req: Request, res: Response) {
  const input = createAdjustmentSchema.parse(req.body);
  const transaction = await walletService.createAdjustment("MANUAL_ADJUSTMENT", input, actorFromRequest(req)!);
  res.status(201).json(transaction);
}

export async function createSettlementAdjustment(req: Request, res: Response) {
  const input = createSettlementAdjustmentSchema.parse(req.body);
  const transaction = await walletService.createAdjustment("SETTLEMENT_ADJUSTMENT", input, actorFromRequest(req)!);
  res.status(201).json(transaction);
}
