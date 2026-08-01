import { describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from "../../common/permissions.js";

describe("RBAC migration data (Module 7)", () => {
  it("seeds exactly the 5 roles with the permission sets defined in permissions.ts", async () => {
    for (const roleKey of Object.values(ROLE_KEYS)) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { key: roleKey },
        include: { permissions: true }
      });
      const actualKeys = role.permissions.map((p) => p.permissionKey).sort();
      const expectedKeys = [...DEFAULT_ROLE_PERMISSIONS[roleKey]].sort();
      expect(actualKeys).toEqual(expectedKeys);
    }
  });

  it("backfilled the legacy admin account to OWNER, not DRIVER", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "admin" },
      include: { role: true }
    });
    expect(admin.role.key).toBe(ROLE_KEYS.OWNER);
  });

  it("backfilled legacy driver accounts to DRIVER", async () => {
    const driver01 = await prisma.user.findUniqueOrThrow({
      where: { username: "driver01" },
      include: { role: true }
    });
    expect(driver01.role.key).toBe(ROLE_KEYS.DRIVER);
  });

  it("every user has exactly one role via the FK (no orphaned role_id)", async () => {
    const users = await prisma.user.findMany({ include: { role: true } });
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.role).toBeTruthy();
    }
  });
});
