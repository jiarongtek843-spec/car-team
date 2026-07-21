import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requirePermission } from "./auth.middleware.js";
import { PERMISSIONS } from "../../common/permissions.js";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("requirePermission", () => {
  it("returns 401 when there is no authenticated user", () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn();

    requirePermission(PERMISSIONS.BOOKING_READ)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the authenticated user lacks the permission", () => {
    const req = {
      authUser: { permissions: [PERMISSIONS.DRIVER_JOBS_SELF] }
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    requirePermission(PERMISSIONS.BOOKING_WRITE)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the authenticated user has the permission", () => {
    const req = {
      authUser: { permissions: [PERMISSIONS.BOOKING_READ, PERMISSIONS.BOOKING_WRITE] }
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    requirePermission(PERMISSIONS.BOOKING_WRITE)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
