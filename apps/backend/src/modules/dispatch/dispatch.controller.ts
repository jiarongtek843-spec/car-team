import type { Request, Response } from "express";
import { z } from "zod";
import * as dispatchService from "./dispatch.service.js";
import * as dispatchOfferService from "./dispatchOffer.service.js";
import { parseIdParam } from "../../common/params.js";
import { actorFromRequest } from "../../common/audit.js";

const bookingFilterSchema = z.enum(["WAITING", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "COMPLETED"]).optional();
const driverFilterSchema = z.enum(["ONLINE", "OFFLINE", "CONNECTION_LOST", "BUSY", "IDLE"]).optional();

const listBookingsQuerySchema = z.object({
  filter: bookingFilterSchema,
  search: z.string().optional(),
  date: z.string().date().optional()
});

const listDriversQuerySchema = z.object({
  filter: driverFilterSchema,
  search: z.string().optional()
});

export async function waitingBookings(req: Request, res: Response) {
  const query = listBookingsQuerySchema.parse(req.query);
  const result = await dispatchService.listWaitingBookings(query);
  res.json(result);
}

export async function drivers(req: Request, res: Response) {
  const query = listDriversQuerySchema.parse(req.query);
  const result = await dispatchService.listDispatchDrivers(query);
  res.json(result);
}

export async function statistics(_req: Request, res: Response) {
  const result = await dispatchService.getDispatchStatistics();
  res.json(result);
}

const legIdParamSchema = z.object({ legId: z.coerce.number().int().positive() });

export async function suggestedDrivers(req: Request, res: Response) {
  const { legId } = legIdParamSchema.parse(req.params);
  const result = await dispatchService.getSuggestedDrivers(legId);
  res.json(result);
}

export async function sendOffer(req: Request, res: Response) {
  const legId = parseIdParam(req.params.legId);
  const offers = await dispatchOfferService.sendOffer(legId, actorFromRequest(req)!);
  res.status(201).json(offers);
}

export async function offersForLeg(req: Request, res: Response) {
  const legId = parseIdParam(req.params.legId);
  const offers = await dispatchOfferService.listOffersForLeg(legId);
  res.json(offers);
}
