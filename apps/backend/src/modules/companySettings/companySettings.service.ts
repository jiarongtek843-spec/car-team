import type { CommissionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ValidationError } from "../../common/errors.js";

/**
 * 单例设定。第一次读取时如果连 migration 的种子资料都不存在（例如全新的空 DB），
 * 就用这里的保底默认值建一笔，而不是在程式码到处写死这些数字。这份默认值要跟
 * schema.prisma 的 @default(...) 保持一致——两边都要设，因为 schema 的 default
 * 只在「有欄位但整张表一笔都不存在」时不会自动套用（这个 create 才是真正的保底）。
 */
export async function getCompanySettings() {
  const existing = await prisma.companySettings.findFirst({ orderBy: { id: "asc" } });
  if (existing) {
    return existing;
  }
  return prisma.companySettings.create({
    data: {
      companyName: "",
      timezone: "Asia/Kuala_Lumpur",
      currency: "RM",
      defaultCommissionType: "PERCENTAGE",
      defaultCommissionValue: 15,
      allowManualLegAllocation: true,
      requireDriverAccept: true,
      gpsUploadIntervalSeconds: 5,
      connectionLostTimeoutSeconds: 30,
      offlineTimeoutSeconds: 120,
      defaultSettlementTime: "21:00",
      settlementTimezone: "Asia/Kuala_Lumpur",
      collectionVerificationRequired: true,
      maxUploadFileSizeMb: 5
    }
  });
}

export interface UpdateCompanySettingsInput {
  companyName?: string;
  timezone?: string;
  currency?: string;
  defaultCommissionType?: CommissionType;
  defaultCommissionValue?: number;
  allowManualLegAllocation?: boolean;
  requireDriverAccept?: boolean;
  gpsUploadIntervalSeconds?: number;
  connectionLostTimeoutSeconds?: number;
  offlineTimeoutSeconds?: number;
  defaultSettlementTime?: string;
  settlementTimezone?: string;
  collectionVerificationRequired?: boolean;
  maxUploadFileSizeMb?: number;
}

/**
 * PATCH 允许只传部分栏位，所以顺序/大小关系（例如 offline > connectionLost > upload interval）
 * 一定要用「合并后的最终值」检查，不能只看这次请求里有没有传——否则可能只改一个栏位就
 * 意外打破跟另一个没传的既有栏位之间的关系。
 */
function assertConsistentThresholds(merged: {
  gpsUploadIntervalSeconds: number;
  connectionLostTimeoutSeconds: number;
  offlineTimeoutSeconds: number;
}) {
  if (merged.connectionLostTimeoutSeconds <= merged.gpsUploadIntervalSeconds) {
    throw new ValidationError("Connection Lost Timeout 必须大于 GPS Upload Interval");
  }
  if (merged.offlineTimeoutSeconds <= merged.connectionLostTimeoutSeconds) {
    throw new ValidationError("Offline Timeout 必须大于 Connection Lost Timeout");
  }
}

export async function updateCompanySettings(input: UpdateCompanySettingsInput) {
  const current = await getCompanySettings();

  const merged = {
    gpsUploadIntervalSeconds: input.gpsUploadIntervalSeconds ?? current.gpsUploadIntervalSeconds,
    connectionLostTimeoutSeconds: input.connectionLostTimeoutSeconds ?? current.connectionLostTimeoutSeconds,
    offlineTimeoutSeconds: input.offlineTimeoutSeconds ?? current.offlineTimeoutSeconds
  };
  assertConsistentThresholds(merged);

  return prisma.companySettings.update({
    where: { id: current.id },
    data: input
  });
}
