import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("never stores the plain text password", async () => {
    const hash = await hashPassword("MySecret123");
    expect(hash).not.toBe("MySecret123");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("MySecret123");
    expect(await verifyPassword("MySecret123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("MySecret123");
    expect(await verifyPassword("WrongPassword", hash)).toBe(false);
  });
});
