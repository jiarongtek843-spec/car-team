import { describe, expect, it } from "vitest";
import { combineBookingMarkers, combineDriverMarkers } from "./markers";
import type { DriverLocationEntry } from "../gps/types";
import type { DriverPresenceEntry } from "../driverPresence/types";
import type { DispatchWaitingLeg } from "../dispatch/types";

function makeLocation(overrides: Partial<DriverLocationEntry> = {}): DriverLocationEntry {
  return {
    driverId: 1,
    driverName: "Driver One",
    latitude: 3.14,
    longitude: 101.68,
    accuracy: 10,
    updatedAt: "2026-07-30T10:00:00.000Z",
    ...overrides
  };
}

function makePresence(overrides: Partial<DriverPresenceEntry> = {}): DriverPresenceEntry {
  return {
    driverId: 1,
    driverName: "Driver One",
    vehiclePlateNumber: "ABC1234",
    status: "AVAILABLE",
    currentBooking: null,
    currentLeg: null,
    lastSeenAt: "2026-07-30T10:00:00.000Z",
    ...overrides
  };
}

function makeLeg(overrides: Partial<DispatchWaitingLeg> = {}): DispatchWaitingLeg {
  return {
    legId: 1,
    bookingId: 100,
    girlName: "Test Girl",
    bookingStatus: "PENDING",
    sequence: 1,
    legType: "OUTBOUND",
    pickupLocation: "KLCC",
    dropoffLocation: null,
    pickupLatitude: 3.1579,
    pickupLongitude: 101.7116,
    scheduledAt: null,
    completedAt: null,
    bookingCreatedAt: "2026-07-30T09:00:00.000Z",
    priority: "NORMAL",
    status: "PENDING",
    rejectionReason: null,
    driver: null,
    ...overrides
  };
}

describe("combineDriverMarkers（Live Dispatch Map join 逻辑）", () => {
  it("joins location + presence by driverId, using presence's status/currentBooking as the source of truth", () => {
    const markers = combineDriverMarkers(
      [makeLocation({ driverId: 1 })],
      [makePresence({ driverId: 1, status: "ON_TRIP", currentBooking: { id: 5, girlName: "X" } })]
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      driverId: 1,
      status: "ON_TRIP",
      currentBooking: { id: 5, girlName: "X" },
      latitude: 3.14,
      longitude: 101.68
    });
  });

  it("drops a location entry with no matching presence entry (defensive, should not happen in practice)", () => {
    const markers = combineDriverMarkers([makeLocation({ driverId: 1 })], [makePresence({ driverId: 2 })]);
    expect(markers).toHaveLength(0);
  });

  it("never produces a marker for a driver that only appears in presence but not in locations (OFFLINE/BREAK naturally excluded)", () => {
    // GPS Foundation 只让 AVAILABLE/PENDING_OFFER/ACCEPTED_JOB/ON_TRIP 上传定位，
    // OFFLINE/BREAK 的 Driver 天生不会出现在 locations 清单里。
    const markers = combineDriverMarkers([], [makePresence({ driverId: 1, status: "OFFLINE" })]);
    expect(markers).toHaveLength(0);
  });

  it("combines multiple drivers correctly", () => {
    const markers = combineDriverMarkers(
      [makeLocation({ driverId: 1 }), makeLocation({ driverId: 2, latitude: 5, longitude: 6 })],
      [makePresence({ driverId: 1 }), makePresence({ driverId: 2, status: "PENDING_OFFER" })]
    );
    expect(markers).toHaveLength(2);
    expect(markers.find((m) => m.driverId === 2)?.status).toBe("PENDING_OFFER");
  });
});

describe("combineBookingMarkers（Live Dispatch Map Booking Pickup Marker 逻辑）", () => {
  it("excludes legs with no pickup coordinates", () => {
    const markers = combineBookingMarkers([makeLeg({ pickupLatitude: null, pickupLongitude: null })]);
    expect(markers).toHaveLength(0);
  });

  it("includes legs with pickup coordinates", () => {
    const markers = combineBookingMarkers([makeLeg()]);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ bookingId: 100, latitude: 3.1579, longitude: 101.7116 });
  });

  it("dedupes multiple waiting legs on the same booking (outbound + return) to one marker", () => {
    const markers = combineBookingMarkers([
      makeLeg({ legId: 1, bookingId: 100, sequence: 1 }),
      makeLeg({ legId: 2, bookingId: 100, sequence: 2, pickupLatitude: 9.9, pickupLongitude: 9.9 })
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0].latitude).toBe(3.1579); // the first (sequence 1) leg's coordinates win
  });

  it("handles a mix of bookings with and without coordinates", () => {
    const markers = combineBookingMarkers([
      makeLeg({ legId: 1, bookingId: 100 }),
      makeLeg({ legId: 2, bookingId: 101, pickupLatitude: null, pickupLongitude: null })
    ]);
    expect(markers.map((m) => m.bookingId)).toEqual([100]);
  });
});
