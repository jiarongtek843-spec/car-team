import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as settlementService from "./settlement.service.js";
import { actorFromRequest } from "../../common/audit.js";

const previewQuerySchema = z.object({
  driverId: z.coerce.number().int().positive(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1)
});

const confirmSchema = z.object({
  driverId: z.coerce.number().int().positive(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1)
});

const voidSchema = z.object({
  reason: z.string().min(1)
});

const listQuerySchema = z.object({
  driverId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

export async function preview(req: Request, res: Response) {
  const { driverId, periodStart, periodEnd } = previewQuerySchema.parse(req.query);
  const result = await settlementService.previewSettlement(driverId, periodStart, periodEnd);
  res.json(result);
}

export async function confirm(req: Request, res: Response) {
  const { driverId, periodStart, periodEnd } = confirmSchema.parse(req.body);
  const settlement = await settlementService.confirmSettlement(driverId, periodStart, periodEnd, actorFromRequest(req)!);
  res.status(201).json(settlement);
}

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const result = await settlementService.listSettlements(query);
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const settlement = await settlementService.getSettlementById(id);
  res.json(settlement);
}

export async function voidOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { reason } = voidSchema.parse(req.body);
  const settlement = await settlementService.voidSettlement(id, reason, actorFromRequest(req)!);
  res.json(settlement);
}
