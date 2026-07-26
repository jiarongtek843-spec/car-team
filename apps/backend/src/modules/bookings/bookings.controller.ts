import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as bookingsService from "./bookings.service.js";
import { actorFromRequest } from "../../common/audit.js";

const bookingStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const commissionTypeSchema = z.enum(["PERCENTAGE", "FIXED_AMOUNT"]);
const legTypeSchema = z.enum(["OUTBOUND", "RETURN", "ADDITIONAL"]);

const legInputSchema = z.object({
  legType: legTypeSchema.optional(),
  pickupLocation: z.string().min(1).optional(),
  dropoffLocation: z.string().min(1).optional(),
  // nullable：null 代表「明确选择时间未定」，跟省略这个栏位是两回事。
  scheduledAt: z.string().datetime().nullable().optional(),
  estimatedDurationMinutes: z.coerce.number().int().positive().nullable().optional(),
  estimatedFinishAt: z.string().datetime().nullable().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
  earningAllocationCents: z.coerce.number().int().nonnegative().optional()
});

const createBookingSchema = z.object({
  girlName: z.string().min(1),
  notes: z.string().optional(),
  totalAmountCents: z.coerce.number().int().nonnegative().optional(),
  commissionType: commissionTypeSchema.optional(),
  commissionValue: z.coerce.number().int().nonnegative().optional(),
  legs: z.array(legInputSchema).optional()
});

const updateBookingSchema = z.object({
  girlName: z.string().min(1).optional(),
  notes: z.string().optional(),
  totalAmountCents: z.coerce.number().int().nonnegative().optional(),
  commissionType: commissionTypeSchema.optional(),
  commissionValue: z.coerce.number().int().nonnegative().optional()
});

const listQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const result = await bookingsService.listBookings(query);
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const booking = await bookingsService.getBookingById(id);
  res.json(booking);
}

export async function create(req: Request, res: Response) {
  const input = createBookingSchema.parse(req.body);
  const booking = await bookingsService.createBooking(input, actorFromRequest(req));
  res.status(201).json(booking);
}

export async function update(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const input = updateBookingSchema.parse(req.body);
  const booking = await bookingsService.updateBooking(id, input, actorFromRequest(req));
  res.json(booking);
}

export async function cancel(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const booking = await bookingsService.cancelBooking(id);
  res.json(booking);
}
