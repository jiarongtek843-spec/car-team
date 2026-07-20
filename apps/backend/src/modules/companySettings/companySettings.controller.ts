import type { Request, Response } from "express";
import { z } from "zod";
import * as companySettingsService from "./companySettings.service.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";

const updateSchema = z.object({
  defaultCommissionType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  defaultCommissionValue: z.coerce.number().int().nonnegative().optional()
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
