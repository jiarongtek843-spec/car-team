import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, ROLE_KEYS } from "./permissions.js";

describe("DEFAULT_ROLE_PERMISSIONS matrix", () => {
  it("defines exactly the 4 roles the product decided on", () => {
    expect(DEFAULT_ROLES.map((r) => r.key).sort()).toEqual(
      [ROLE_KEYS.OWNER, ROLE_KEYS.MANAGER, ROLE_KEYS.DISPATCHER, ROLE_KEYS.DRIVER].sort()
    );
  });

  it("OWNER has every admin-side permission, including Company Settings, Booking Charge Void, and Revenue Sharing Finalize", () => {
    const owner = DEFAULT_ROLE_PERMISSIONS.OWNER;
    expect(owner).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);
    expect(owner).toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
    expect(owner).toContain(PERMISSIONS.WALLET_WRITE);
    expect(owner).toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(owner).toContain(PERMISSIONS.COLLECTION_WRITE);
    expect(owner).toContain(PERMISSIONS.BOOKING_CHARGE_READ);
    expect(owner).toContain(PERMISSIONS.BOOKING_CHARGE_WRITE);
    expect(owner).toContain(PERMISSIONS.BOOKING_CHARGE_VOID);
    expect(owner).toContain(PERMISSIONS.REVENUE_SHARING_READ);
    expect(owner).toContain(PERMISSIONS.REVENUE_SHARING_PREVIEW);
    expect(owner).toContain(PERMISSIONS.REVENUE_SHARING_FINALIZE);
  });

  it("MANAGER has all day-to-day operations including Booking Charge Void and Revenue Sharing Finalize (RBAC-level), can read but not write Company Settings", () => {
    const manager = DEFAULT_ROLE_PERMISSIONS.MANAGER;
    expect(manager).toContain(PERMISSIONS.BOOKING_WRITE);
    expect(manager).toContain(PERMISSIONS.DRIVER_WRITE);
    expect(manager).toContain(PERMISSIONS.WALLET_WRITE);
    expect(manager).toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(manager).toContain(PERMISSIONS.COLLECTION_WRITE);
    expect(manager).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);
    expect(manager).toContain(PERMISSIONS.BOOKING_CHARGE_READ);
    expect(manager).toContain(PERMISSIONS.BOOKING_CHARGE_WRITE);
    expect(manager).toContain(PERMISSIONS.BOOKING_CHARGE_VOID);
    expect(manager).toContain(PERMISSIONS.REVENUE_SHARING_READ);
    expect(manager).toContain(PERMISSIONS.REVENUE_SHARING_PREVIEW);
    // RBAC 层拥有 revenueSharing:finalize 只代表「有资格」，实际能不能 Finalize（现在会
    // 自动发放 Wallet）还要看 CompanySettings.allowManagerFinalizeRevenueSharing——
    // 那个开关不是 permissions.ts 管的事，见 revenueSharing.service.ts 的 assertCanFinalize。
    expect(manager).toContain(PERMISSIONS.REVENUE_SHARING_FINALIZE);
    expect(manager).not.toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
  });

  it("DISPATCHER can Create/View Booking Charge but not Void it, can only View Revenue Sharing, and has zero other financial access", () => {
    const dispatcher = DEFAULT_ROLE_PERMISSIONS.DISPATCHER;
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_READ);
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_WRITE);
    expect(dispatcher).toContain(PERMISSIONS.DRIVER_READ);
    expect(dispatcher).toContain(PERMISSIONS.DISPATCH_READ);
    expect(dispatcher).toContain(PERMISSIONS.GPS_READ);
    expect(dispatcher).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_CHARGE_READ);
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_CHARGE_WRITE);
    expect(dispatcher).toContain(PERMISSIONS.REVENUE_SHARING_READ);

    expect(dispatcher).not.toContain(PERMISSIONS.BOOKING_CHARGE_VOID);
    expect(dispatcher).not.toContain(PERMISSIONS.REVENUE_SHARING_PREVIEW);
    expect(dispatcher).not.toContain(PERMISSIONS.REVENUE_SHARING_FINALIZE);
    expect(dispatcher).not.toContain(PERMISSIONS.DRIVER_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.WALLET_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.WALLET_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.SETTLEMENT_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.COLLECTION_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.COLLECTION_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
  });

  it("DRIVER only has self-service permissions plus companySettings:read, never Booking Charge, Revenue Sharing, or the admin-side driver:* keys", () => {
    const driver = DEFAULT_ROLE_PERMISSIONS.DRIVER;
    expect(driver.sort()).toEqual(
      [
        PERMISSIONS.DRIVER_JOBS_SELF,
        PERMISSIONS.DRIVER_WALLET_SELF,
        PERMISSIONS.DRIVER_COLLECTION_SELF,
        PERMISSIONS.DRIVER_PRESENCE_SELF,
        PERMISSIONS.DRIVER_SETTLEMENT_SELF,
        PERMISSIONS.COMPANY_SETTINGS_READ
      ].sort()
    );
    expect(driver).not.toContain(PERMISSIONS.DRIVER_READ);
    expect(driver).not.toContain(PERMISSIONS.DRIVER_WRITE);
    expect(driver).not.toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
    expect(driver).not.toContain(PERMISSIONS.BOOKING_CHARGE_READ);
    expect(driver).not.toContain(PERMISSIONS.BOOKING_CHARGE_WRITE);
    expect(driver).not.toContain(PERMISSIONS.BOOKING_CHARGE_VOID);
    expect(driver).not.toContain(PERMISSIONS.REVENUE_SHARING_READ);
    expect(driver).not.toContain(PERMISSIONS.REVENUE_SHARING_PREVIEW);
    expect(driver).not.toContain(PERMISSIONS.REVENUE_SHARING_FINALIZE);
  });
});
