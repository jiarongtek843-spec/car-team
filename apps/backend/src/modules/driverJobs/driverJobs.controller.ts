import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import { ForbiddenError } from "../../common/errors.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";
import * as driverJobsService from "./driverJobs.service.js";

const rejectSchema = z.object({
  reason: z.string().min(1)
});

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function list(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legs = await driverJobsService.listMyLegs(driverId);
  res.json(legs);
}

export async function accept(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legId = parseIdParam(req.params.legId);
  const leg = await driverJobsService.acceptLeg(driverId, legId);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_ACCEPT",
    entityType: "Leg",
    entityId: legId
  });

  res.json(leg);
}

export async function reject(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legId = parseIdParam(req.params.legId);
  const { reason } = rejectSchema.parse(req.body);
  const leg = await driverJobsService.rejectLeg(driverId, legId, reason);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_REJECT",
    entityType: "Leg",
    entityId: legId,
    metadata: { reason }
  });

  res.json(leg);
}

export async function arriving(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legId = parseIdParam(req.params.legId);
  const leg = await driverJobsService.markDriverArriving(driverId, legId);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_DRIVER_ARRIVING",
    entityType: "Leg",
    entityId: legId
  });

  res.json(leg);
}

export async function onBoard(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legId = parseIdParam(req.params.legId);
  const leg = await driverJobsService.markPassengerOnBoard(driverId, legId);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_PASSENGER_ON_BOARD",
    entityType: "Leg",
    entityId: legId
  });

  res.json(leg);
}

export async function complete(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const legId = parseIdParam(req.params.legId);
  const leg = await driverJobsService.completeLeg(driverId, legId, actorFromRequest(req)!);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_COMPLETE",
    entityType: "Leg",
    entityId: legId
  });

  res.json(leg);
}
