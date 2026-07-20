import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import { actorFromRequest } from "../../common/audit.js";
import * as gpsService from "./gps.service.js";

const pingSchema = z.object({
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  speed: z.coerce.number().optional(),
  heading: z.coerce.number().optional(),
  batteryPercent: z.coerce.number().int().min(0).max(100).optional(),
  recordedAt: z.string().optional()
});

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function goOnline(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const driver = await gpsService.goOnline(driverId, actorFromRequest(req)!);
  res.json(driver);
}

export async function goOffline(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const driver = await gpsService.goOffline(driverId, actorFromRequest(req)!);
  res.json(driver);
}

export async function ping(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const input = pingSchema.parse(req.body);
  const location = await gpsService.recordPing(driverId, input);
  res.status(201).json(location);
}

export async function me(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const presence = await gpsService.getDriverPresence(driverId);
  res.json(presence);
}
