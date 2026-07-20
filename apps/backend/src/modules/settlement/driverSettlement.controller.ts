import type { Request, Response } from "express";
import { ForbiddenError } from "../../common/errors.js";
import * as settlementService from "./settlement.service.js";

export async function list(req: Request, res: Response) {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  const settlements = await settlementService.listDriverSettlements(driverId);
  res.json(settlements);
}
