import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, ROLE_KEYS } from "./permissions.js";

describe("DEFAULT_ROLE_PERMISSIONS matrix", () => {
  it("defines exactly the 4 roles the product decided on", () => {
    expect(DEFAULT_ROLES.map((r) => r.key).sort()).toEqual(
      [ROLE_KEYS.OWNER, ROLE_KEYS.MANAGER, ROLE_KEYS.DISPATCHER, ROLE_KEYS.DRIVER].sort()
    );
  });

  it("OWNER has every admin-side permission, including Company Settings", () => {
    const owner = DEFAULT_ROLE_PERMISSIONS.OWNER;
    expect(owner).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);
    expect(owner).toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
    expect(owner).toContain(PERMISSIONS.WALLET_WRITE);
    expect(owner).toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(owner).toContain(PERMISSIONS.COLLECTION_WRITE);
  });

  it("MANAGER has all day-to-day operations including Booking Charge Void, can read but not write Company Settings", () => {
    const manager = DEFAULT_ROLE_PERMISSIONS.MANAGER;
    expect(manager).toContain(PERMISSIONS.BOOKING_WRITE);
    expect(manager).toContain(PERMISSIONS.DRIVER_WRITE);
    expect(manager).toContain(PERMISSIONS.WALLET_WRITE);
    expect(manager).toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(manager).toContain(PERMISSIONS.COLLECTION_WRITE);
    expect(manager).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);
    expect(manager).not.toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
  });

  it("DISPATCHER can use Booking/Dispatch and view Driver/GPS, but has zero financial access", () => {
    const dispatcher = DEFAULT_ROLE_PERMISSIONS.DISPATCHER;
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_READ);
    expect(dispatcher).toContain(PERMISSIONS.BOOKING_WRITE);
    expect(dispatcher).toContain(PERMISSIONS.DRIVER_READ);
    expect(dispatcher).toContain(PERMISSIONS.DISPATCH_READ);
    expect(dispatcher).toContain(PERMISSIONS.GPS_READ);
    expect(dispatcher).toContain(PERMISSIONS.COMPANY_SETTINGS_READ);

    expect(dispatcher).not.toContain(PERMISSIONS.DRIVER_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.WALLET_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.WALLET_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.SETTLEMENT_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.SETTLEMENT_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.COLLECTION_READ);
    expect(dispatcher).not.toContain(PERMISSIONS.COLLECTION_WRITE);
    expect(dispatcher).not.toContain(PERMISSIONS.COMPANY_SETTINGS_WRITE);
  });

  it("DRIVER only has self-service permissions plus companySettings:read, never the admin-side driver:* keys", () => {
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
  });
});
