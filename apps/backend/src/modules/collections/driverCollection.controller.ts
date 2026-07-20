import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError, ValidationError } from "../../common/errors.js";
import { parseIdParam } from "../../common/params.js";
import { actorFromRequest } from "../../common/audit.js";
import { collectionProofImageUrl } from "../../common/upload.js";
import * as collectionService from "./collection.service.js";

const paymentMethodSchema = z.enum(["CASH", "TRANSFER_TO_DRIVER", "TRANSFER_TO_COMPANY", "TNG", "OTHER"]);
const purposeSchema = z.enum(["ITEM_PURCHASE", "DELIVERY_FEE", "PARCEL", "EXTRA_CHARGE", "PARKING", "TOLL", "OTHER"]);
const statusSchema = z.enum(["PENDING", "COLLECTED", "VERIFIED", "SETTLED", "VOIDED"]);

const createSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  legId: z.coerce.number().int().positive().optional(),
  customerName: z.string().optional(),
  purpose: purposeSchema,
  amountCents: z.coerce.number().int().positive(),
  paymentMethod: paymentMethodSchema,
  collectedAt: z.string().optional(),
  remark: z.string().optional()
});

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function create(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const input = createSchema.parse(req.body);
  const collection = await collectionService.createCollection({ ...input, driverId }, actorFromRequest(req)!);
  res.status(201).json(collection);
}

export async function list(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const query = listQuerySchema.parse(req.query);
  const result = await collectionService.listCollections({ ...query, driverId });
  res.json(result);
}

export async function getOne(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const id = parseIdParam(req.params.id);
  const collection = await collectionService.getCollectionById(id);
  if (collection.driverId !== driverId) {
    throw new ForbiddenError("This collection does not belong to you");
  }
  res.json(collection);
}

export async function uploadProof(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const id = parseIdParam(req.params.id);
  if (!req.file) {
    throw new ValidationError("Missing file");
  }
  const proofImageUrl = collectionProofImageUrl(req.file.filename);
  const collection = await collectionService.attachProofImage(id, driverId, proofImageUrl, actorFromRequest(req)!);
  res.json(collection);
}
