import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as legsService from "./legs.service.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";

const addLegSchema = z.object({
  pickupLocation: z.string().min(1).optional(),
  dropoffLocation: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
  earningAllocationCents: z.coerce.number().int().nonnegative().optional()
});

const updateLegSchema = z.object({
  pickupLocation: z.string().min(1).optional(),
  dropoffLocation: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  earningAllocationCents: z.coerce.number().int().nonnegative().optional()
});

const assignDriverSchema = z.object({
  driverId: z.coerce.number().int().positive()
});

function parseIds(req: Request) {
  return {
    bookingId: parseIdParam(req.params.id),
    legId: parseIdParam(req.params.legId)
  };
}

export async function add(req: Request, res: Response) {
  const bookingId = parseIdParam(req.params.id);
  const input = addLegSchema.parse(req.body);
  const booking = await legsService.addLeg(bookingId, input);
  res.status(201).json(booking);
}

export async function update(req: Request, res: Response) {
  const { bookingId, legId } = parseIds(req);
  const input = updateLegSchema.parse(req.body);
  const booking = await legsService.updateLeg(bookingId, legId, input, actorFromRequest(req));
  res.json(booking);
}

export async function assign(req: Request, res: Response) {
  const { bookingId, legId } = parseIds(req);
  const { driverId } = assignDriverSchema.parse(req.body);
  const booking = await legsService.assignDriver(bookingId, legId, driverId);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_ASSIGN",
    entityType: "Leg",
    entityId: legId,
    metadata: { driverId }
  });

  res.json(booking);
}

export async function cancel(req: Request, res: Response) {
  const { bookingId, legId } = parseIds(req);
  const booking = await legsService.cancelLeg(bookingId, legId);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "LEG_CANCEL",
    entityType: "Leg",
    entityId: legId
  });

  res.json(booking);
}

export async function remove(req: Request, res: Response) {
  const { bookingId, legId } = parseIds(req);
  const booking = await legsService.deleteLeg(bookingId, legId);
  res.json(booking);
}
