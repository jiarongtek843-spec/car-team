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
  periodEnd: z.string().min(1),
  // Selective Settlement（功能五）：不传就维持原本「整个周期全部结算」的行为；传了就只结算
  // 这两份清单里的 id（Backend 会重新验证、重新算金额，见 settlement.service.ts
  // resolveSettlementItems——不接受前端算好的金额）。Adjustment 跟 Wallet Earning 在资料模型
  // 上是同一张 wallet_transactions 表，不是独立实体，所以合并在 selectedWalletTransactionIds
  // 里，不需要另外一个 selectedAdjustmentIds。
  selectedWalletTransactionIds: z.array(z.coerce.number().int().positive()).optional(),
  selectedCollectionIds: z.array(z.coerce.number().int().positive()).optional()
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
  const { driverId, periodStart, periodEnd, selectedWalletTransactionIds, selectedCollectionIds } = confirmSchema.parse(
    req.body
  );
  const selection =
    selectedWalletTransactionIds !== undefined || selectedCollectionIds !== undefined
      ? { walletTransactionIds: selectedWalletTransactionIds, collectionIds: selectedCollectionIds }
      : undefined;
  const settlement = await settlementService.confirmSettlement(
    driverId,
    periodStart,
    periodEnd,
    actorFromRequest(req)!,
    selection
  );
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
