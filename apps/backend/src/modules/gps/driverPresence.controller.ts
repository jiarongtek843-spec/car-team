import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import { actorFromRequest } from "../../common/audit.js";
import * as gpsService from "./gps.service.js";

const pingSchema = z.object({
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  accuracy: z.coerce.number().min(0).optional(),
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

/**
 * Mobile UAT Bug Fix（Driver Online 状态同步）：之前这里只回传原始 Driver 记录（isOnline 布林值），
 * Frontend 得另外再打一次 GET /me、靠 react-query 的 invalidateQueries 重新拉一次才能知道
 * 最新状态——这中间隔了一次额外的网路来回，会跟 useMyPresenceQuery 的 5 秒轮询产生竞态。
 * 改成直接回传跟 GET /me 完全同一份 `DriverPresence`（同一个 getDriverPresence 计算），
 * Frontend 收到这个回应就能直接拿来更新 UI，不需要再等第二次网路请求。
 */
export async function goOnline(req: Request, res: Response) {
  const driverId = getDriverId(req);
  await gpsService.goOnline(driverId, actorFromRequest(req)!);
  const presence = await gpsService.getDriverPresence(driverId);
  res.json(presence);
}

export async function goOffline(req: Request, res: Response) {
  const driverId = getDriverId(req);
  await gpsService.goOffline(driverId, actorFromRequest(req)!);
  const presence = await gpsService.getDriverPresence(driverId);
  res.json(presence);
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
