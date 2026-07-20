import type { CommissionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/**
 * 单例设定。第一次读取时如果连 migration 的种子资料都不存在（例如全新的空 DB），
 * 就用这里的保底默认值建一笔，而不是在程式码到处写死 15%。
 */
export async function getCompanySettings() {
  const existing = await prisma.companySettings.findFirst({ orderBy: { id: "asc" } });
  if (existing) {
    return existing;
  }
  return prisma.companySettings.create({
    data: { defaultCommissionType: "PERCENTAGE", defaultCommissionValue: 15 }
  });
}

export async function updateCompanySettings(input: {
  defaultCommissionType?: CommissionType;
  defaultCommissionValue?: number;
}) {
  const current = await getCompanySettings();
  return prisma.companySettings.update({
    where: { id: current.id },
    data: input
  });
}
