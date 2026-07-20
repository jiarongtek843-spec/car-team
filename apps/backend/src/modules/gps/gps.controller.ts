import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as gpsService from "./gps.service.js";

const listQuerySchema = z.object({
  onlineOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false")
});

export async function list(req: Request, res: Response) {
  const { onlineOnly } = listQuerySchema.parse(req.query);
  const result = await gpsService.listDriverPresence(onlineOnly);
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const driverId = parseIdParam(req.params.driverId);
  const result = await gpsService.getDriverPresence(driverId);
  res.json(result);
}
