import type { Request, Response } from "express";
import { z } from "zod";
import * as companySettingsService from "./companySettings.service.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateSchema = z.object({
  // General
  companyName: z.string().trim().max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  currency: z.string().trim().min(1).max(10).optional(),

  // Booking
  defaultCommissionType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  defaultCommissionValue: z.coerce.number().int().nonnegative().optional(),
  allowManualLegAllocation: z.boolean().optional(),
  requireDriverAccept: z.boolean().optional(),

  // GPS
  gpsUploadIntervalSeconds: z.coerce.number().int().min(1).max(300).optional(),
  connectionLostTimeoutSeconds: z.coerce.number().int().min(1).max(3600).optional(),
  offlineTimeoutSeconds: z.coerce.number().int().min(1).max(3600).optional(),

  // Settlement
  defaultSettlementTime: z.string().regex(HHMM_REGEX, "格式必须是 HH:mm，例如 21:00").optional(),
  settlementTimezone: z.string().trim().min(1).max(100).optional(),

  // Collection
  collectionVerificationRequired: z.boolean().optional(),
  maxUploadFileSizeMb: z.coerce.number().int().min(1).max(20).optional(),

  // Revenue Sharing（Module 11）
  companyCommissionType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  companyCommissionValue: z.coerce.number().int().nonnegative().optional(),
  dispatcherCommissionType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  dispatcherCommissionValue: z.coerce.number().int().nonnegative().optional()
});

export async function get(_req: Request, res: Response) {
  const settings = await companySettingsService.getCompanySettings();
  res.json(settings);
}

export async function update(req: Request, res: Response) {
  const input = updateSchema.parse(req.body);
  const before = await companySettingsService.getCompanySettings();
  const after = await companySettingsService.updateCompanySettings(input);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "COMPANY_SETTINGS_UPDATE",
    entityType: "CompanySettings",
    entityId: after.id,
    beforeData: before,
    afterData: after
  });

  res.json(after);
}
