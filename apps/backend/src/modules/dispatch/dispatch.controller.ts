import type { Request, Response } from "express";
import { z } from "zod";
import * as dispatchService from "./dispatch.service.js";

const bookingFilterSchema = z.enum(["WAITING", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"]).optional();
const driverFilterSchema = z.enum(["ONLINE", "OFFLINE", "CONNECTION_LOST", "BUSY", "IDLE"]).optional();

const listBookingsQuerySchema = z.object({
  filter: bookingFilterSchema,
  search: z.string().optional()
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
