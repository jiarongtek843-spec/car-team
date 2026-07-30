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

// GPS Foundation：Admin Get Driver Locations API——只回传 latest location（driverId/
// latitude/longitude/accuracy/updatedAt），不含既有 /drivers 那份 presence+activeLeg
// 合并资讯，专门给未来 Live Map 之类的功能重用。
export async function locations(_req: Request, res: Response) {
  const result = await gpsService.getDriverLocations();
  res.json(result);
}
