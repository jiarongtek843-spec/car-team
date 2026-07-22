import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as companySettingsService from "./companySettings.service.js";
import { ValidationError } from "../../common/errors.js";

// company_settings 是单例表，其他 Module 的测试（例如 Booking 建立时读预设抽成）也依赖这张表
// 现有的值，所以每个测试前先记住原始值，跑完再原样写回去，不能留下污染给其他测试文件。
let originalSettings: Awaited<ReturnType<typeof companySettingsService.getCompanySettings>>;

beforeEach(async () => {
  originalSettings = await companySettingsService.getCompanySettings();
});

afterEach(async () => {
  await prisma.companySettings.update({
    where: { id: originalSettings.id },
    data: {
      companyName: originalSettings.companyName,
      timezone: originalSettings.timezone,
      currency: originalSettings.currency,
      defaultCommissionType: originalSettings.defaultCommissionType,
      defaultCommissionValue: originalSettings.defaultCommissionValue,
      allowManualLegAllocation: originalSettings.allowManualLegAllocation,
      requireDriverAccept: originalSettings.requireDriverAccept,
      gpsUploadIntervalSeconds: originalSettings.gpsUploadIntervalSeconds,
      connectionLostTimeoutSeconds: originalSettings.connectionLostTimeoutSeconds,
      offlineTimeoutSeconds: originalSettings.offlineTimeoutSeconds,
      defaultSettlementTime: originalSettings.defaultSettlementTime,
      settlementTimezone: originalSettings.settlementTimezone,
      collectionVerificationRequired: originalSettings.collectionVerificationRequired,
      maxUploadFileSizeMb: originalSettings.maxUploadFileSizeMb,
      companyCommissionType: originalSettings.companyCommissionType,
      companyCommissionValue: originalSettings.companyCommissionValue,
      dispatcherCommissionType: originalSettings.dispatcherCommissionType,
      dispatcherCommissionValue: originalSettings.dispatcherCommissionValue,
      allowManagerFinalizeRevenueSharing: originalSettings.allowManagerFinalizeRevenueSharing
    }
  });
});

describe("CompanySettings (Module 8)", () => {
  it("persists a General field update", async () => {
    const updated = await companySettingsService.updateCompanySettings({ companyName: "Test Fleet Sdn Bhd" });
    expect(updated.companyName).toBe("Test Fleet Sdn Bhd");

    const reread = await companySettingsService.getCompanySettings();
    expect(reread.companyName).toBe("Test Fleet Sdn Bhd");
  });

  it("persists Collection settings (maxUploadFileSizeMb / collectionVerificationRequired)", async () => {
    const updated = await companySettingsService.updateCompanySettings({
      maxUploadFileSizeMb: 8,
      collectionVerificationRequired: false
    });
    expect(updated.maxUploadFileSizeMb).toBe(8);
    expect(updated.collectionVerificationRequired).toBe(false);
  });

  it("rejects a full GPS threshold update where connectionLost <= uploadInterval", async () => {
    await expect(
      companySettingsService.updateCompanySettings({
        gpsUploadIntervalSeconds: 30,
        connectionLostTimeoutSeconds: 30,
        offlineTimeoutSeconds: 120
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a full GPS threshold update where offline <= connectionLost", async () => {
    await expect(
      companySettingsService.updateCompanySettings({
        gpsUploadIntervalSeconds: 5,
        connectionLostTimeoutSeconds: 60,
        offlineTimeoutSeconds: 60
      })
    ).rejects.toThrow(ValidationError);
  });

  it("validates a partial update against the merged (existing + new) thresholds, not just the fields in the request", async () => {
    await companySettingsService.updateCompanySettings({
      gpsUploadIntervalSeconds: 5,
      connectionLostTimeoutSeconds: 30,
      offlineTimeoutSeconds: 120
    });

    // 只改 offlineTimeoutSeconds，没有传 connectionLostTimeoutSeconds，但新值会跟既有的
    // connectionLostTimeoutSeconds(30) 冲突，仍然要被挡下来。
    await expect(companySettingsService.updateCompanySettings({ offlineTimeoutSeconds: 20 })).rejects.toThrow(
      ValidationError
    );
  });

  it("accepts a consistent partial update", async () => {
    await companySettingsService.updateCompanySettings({
      gpsUploadIntervalSeconds: 5,
      connectionLostTimeoutSeconds: 30,
      offlineTimeoutSeconds: 120
    });

    const updated = await companySettingsService.updateCompanySettings({ offlineTimeoutSeconds: 90 });
    expect(updated.offlineTimeoutSeconds).toBe(90);
    expect(updated.connectionLostTimeoutSeconds).toBe(30);
  });

  it("persists Revenue Sharing rule fields (companyCommission/dispatcherCommission type+value)", async () => {
    const updated = await companySettingsService.updateCompanySettings({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 20,
      dispatcherCommissionType: "FIXED_AMOUNT",
      dispatcherCommissionValue: 300
    });

    expect(updated.companyCommissionType).toBe("PERCENTAGE");
    expect(updated.companyCommissionValue).toBe(20);
    expect(updated.dispatcherCommissionType).toBe("FIXED_AMOUNT");
    expect(updated.dispatcherCommissionValue).toBe(300);
  });

  it("rejects companyCommission% + dispatcherCommission% over 100 when both are PERCENTAGE", async () => {
    await expect(
      companySettingsService.updateCompanySettings({
        companyCommissionType: "PERCENTAGE",
        companyCommissionValue: 80,
        dispatcherCommissionType: "PERCENTAGE",
        dispatcherCommissionValue: 30
      })
    ).rejects.toThrow(ValidationError);
  });

  it("validates the merged Revenue Sharing rule on a partial update, not just the fields in the request", async () => {
    await companySettingsService.updateCompanySettings({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 70,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 20
    });

    // 只改 dispatcherCommissionValue，没有传 companyCommissionValue，但合并后 70+40=110% 仍然要被挡下来。
    await expect(companySettingsService.updateCompanySettings({ dispatcherCommissionValue: 40 })).rejects.toThrow(
      ValidationError
    );
  });

  it("allows a PERCENTAGE + FIXED_AMOUNT combination regardless of value (can't be validated without a booking's actual total)", async () => {
    const updated = await companySettingsService.updateCompanySettings({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 90,
      dispatcherCommissionType: "FIXED_AMOUNT",
      dispatcherCommissionValue: 999999
    });

    expect(updated.companyCommissionValue).toBe(90);
    expect(updated.dispatcherCommissionValue).toBe(999999);
  });

  it("allowManagerFinalizeRevenueSharing defaults to false and can be toggled", async () => {
    expect(originalSettings.allowManagerFinalizeRevenueSharing).toBe(false);

    const enabled = await companySettingsService.updateCompanySettings({ allowManagerFinalizeRevenueSharing: true });
    expect(enabled.allowManagerFinalizeRevenueSharing).toBe(true);

    const disabled = await companySettingsService.updateCompanySettings({ allowManagerFinalizeRevenueSharing: false });
    expect(disabled.allowManagerFinalizeRevenueSharing).toBe(false);
  });
});
