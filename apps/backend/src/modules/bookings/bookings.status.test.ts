import { describe, expect, it } from "vitest";
import { deriveBookingStatus } from "./bookings.status.js";

describe("deriveBookingStatus", () => {
  it("returns PENDING when there are no legs", () => {
    expect(deriveBookingStatus("PENDING", [])).toBe("PENDING");
  });

  it("stays CANCELLED once manually cancelled, regardless of leg states", () => {
    expect(deriveBookingStatus("CANCELLED", [{ status: "COMPLETED" }])).toBe("CANCELLED");
  });

  it("is CANCELLED when every leg ends up cancelled", () => {
    expect(deriveBookingStatus("PENDING", [{ status: "CANCELLED" }, { status: "CANCELLED" }])).toBe("CANCELLED");
  });

  it("is PENDING when legs are unassigned or only rejected", () => {
    expect(deriveBookingStatus("PENDING", [{ status: "PENDING" }])).toBe("PENDING");
    expect(deriveBookingStatus("PENDING", [{ status: "REJECTED" }])).toBe("PENDING");
  });

  it("is IN_PROGRESS once any leg is actively being handled", () => {
    expect(deriveBookingStatus("PENDING", [{ status: "ASSIGNED" }])).toBe("IN_PROGRESS");
    expect(deriveBookingStatus("PENDING", [{ status: "ACCEPTED" }])).toBe("IN_PROGRESS");
    expect(deriveBookingStatus("PENDING", [{ status: "DRIVER_ARRIVING" }])).toBe("IN_PROGRESS");
    expect(deriveBookingStatus("PENDING", [{ status: "PASSENGER_ON_BOARD" }])).toBe("IN_PROGRESS");
  });

  it("is IN_PROGRESS when one leg is completed but another is still pending", () => {
    expect(deriveBookingStatus("PENDING", [{ status: "COMPLETED" }, { status: "PENDING" }])).toBe("IN_PROGRESS");
  });

  it("is COMPLETED only once every non-cancelled leg is completed", () => {
    expect(
      deriveBookingStatus("PENDING", [{ status: "COMPLETED" }, { status: "COMPLETED" }, { status: "CANCELLED" }])
    ).toBe("COMPLETED");
  });

  it("a rejected leg blocks COMPLETED even if the rest are done", () => {
    expect(deriveBookingStatus("PENDING", [{ status: "COMPLETED" }, { status: "REJECTED" }])).toBe("IN_PROGRESS");
  });
});
