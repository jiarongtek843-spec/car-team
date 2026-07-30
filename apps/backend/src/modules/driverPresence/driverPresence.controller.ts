import type { Request, Response } from "express";
import * as driverPresenceService from "./driverPresence.service.js";

export async function list(_req: Request, res: Response) {
  const presence = await driverPresenceService.listPresence();
  res.json(presence);
}
