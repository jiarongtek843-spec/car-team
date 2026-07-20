import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import * as walletService from "./wallet.service.js";

const statusSchema = z.enum(["PENDING", "SETTLED", "VOIDED"]);

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function summary(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const result = await walletService.getDriverWalletSummary(driverId);
  res.json(result);
}

export async function transactions(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const query = listQuerySchema.parse(req.query);
  const result = await walletService.listTransactions({ ...query, driverId });
  res.json(result);
}
