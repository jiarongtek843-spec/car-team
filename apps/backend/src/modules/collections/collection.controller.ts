import type { Request, Response } from "express";
import { z } from "zod";
import { parseIdParam } from "../../common/params.js";
import * as collectionService from "./collection.service.js";
import { actorFromRequest } from "../../common/audit.js";

const paymentMethodSchema = z.enum(["CASH", "TRANSFER_TO_DRIVER", "TRANSFER_TO_COMPANY", "TNG", "OTHER"]);
const purposeSchema = z.enum(["ITEM_PURCHASE", "DELIVERY_FEE", "PARCEL", "EXTRA_CHARGE", "PARKING", "TOLL", "OTHER"]);
const statusSchema = z.enum(["PENDING", "COLLECTED", "VERIFIED", "SETTLED", "VOIDED"]);

const listQuerySchema = z.object({
  driverId: z.coerce.number().int().positive().optional(),
  bookingId: z.coerce.number().int().positive().optional(),
  status: statusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  purpose: purposeSchema.optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

const voidSchema = z.object({
  reason: z.string().min(1)
});

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const result = await collectionService.listCollections(query);
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const collection = await collectionService.getCollectionById(id);
  res.json(collection);
}

export async function verify(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const collection = await collectionService.verifyCollection(id, actorFromRequest(req)!);
  res.json(collection);
}

export async function voidOne(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { reason } = voidSchema.parse(req.body);
  const collection = await collectionService.voidCollection(id, reason, actorFromRequest(req)!);
  res.json(collection);
}
