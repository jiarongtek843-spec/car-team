import { describe, expect, it } from "vitest";
import { computePresenceStatus, CONNECTION_LOST_THRESHOLD_SECONDS, AUTO_OFFLINE_THRESHOLD_SECONDS } from "./gps.service.js";

const NOW = new Date("2026-07-21T12:00:00.000Z");

function secondsAgo(seconds: number) {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("computePresenceStatus", () => {
  it("returns OFFLINE when the driver is not online, regardless of location freshness", () => {
    const result = computePresenceStatus({
      isOnline: false,
      onlineSince: null,
      locationReceivedAt: secondsAgo(1),
      activeLegStatus: null,
      now: NOW
    });
    expect(result).toEqual({ status: "OFFLINE", secondsSinceUpdate: null });
  });

  it("returns ONLINE when online, no active leg, and location is fresh", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(60),
      locationReceivedAt: secondsAgo(3),
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("ONLINE");
    expect(result.secondsSinceUpdate).toBe(3);
  });

  it("returns CONNECTION_LOST just past the 30s threshold", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(CONNECTION_LOST_THRESHOLD_SECONDS + 1),
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("CONNECTION_LOST");
  });

  it("stays ONLINE exactly at the 30s threshold (not yet past it)", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(CONNECTION_LOST_THRESHOLD_SECONDS),
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("ONLINE");
  });

  it("returns OFFLINE past the 120s auto-offline threshold even though isOnline is still true in DB", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(AUTO_OFFLINE_THRESHOLD_SECONDS + 1),
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("OFFLINE");
  });

  it("shows the active leg's status instead of plain ONLINE when GPS is fresh and a leg is in progress", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(2),
      activeLegStatus: "PASSENGER_ON_BOARD",
      now: NOW
    });
    expect(result.status).toBe("PASSENGER_ON_BOARD");
  });

  it("prioritizes CONNECTION_LOST over the active leg status when GPS is stale", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(CONNECTION_LOST_THRESHOLD_SECONDS + 5),
      activeLegStatus: "PASSENGER_ON_BOARD",
      now: NOW
    });
    expect(result.status).toBe("CONNECTION_LOST");
  });

  it("falls back to onlineSince when no location has ever been received", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(5),
      locationReceivedAt: null,
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("ONLINE");
    expect(result.secondsSinceUpdate).toBe(5);
  });

  it("auto-offlines a driver who never sent a single ping after going online more than 120s ago", () => {
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(AUTO_OFFLINE_THRESHOLD_SECONDS + 30),
      locationReceivedAt: null,
      activeLegStatus: null,
      now: NOW
    });
    expect(result.status).toBe("OFFLINE");
  });

  it("Module 8: respects a custom connectionLostThresholdSeconds passed from CompanySettings instead of the default 30s", () => {
    // 15 秒前的定位，用默认 30 秒门槛还算新鲜，但用 CompanySettings 设定的 10 秒门槛就该算 Connection Lost。
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(15),
      activeLegStatus: null,
      now: NOW,
      connectionLostThresholdSeconds: 10,
      autoOfflineThresholdSeconds: AUTO_OFFLINE_THRESHOLD_SECONDS
    });
    expect(result.status).toBe("CONNECTION_LOST");
  });

  it("Module 8: respects a custom autoOfflineThresholdSeconds passed from CompanySettings instead of the default 120s", () => {
    // 50 秒前的定位，用默认 120 秒门槛还在线，但用 CompanySettings 设定的 45 秒门槛就该自动 Offline。
    const result = computePresenceStatus({
      isOnline: true,
      onlineSince: secondsAgo(600),
      locationReceivedAt: secondsAgo(50),
      activeLegStatus: null,
      now: NOW,
      connectionLostThresholdSeconds: CONNECTION_LOST_THRESHOLD_SECONDS,
      autoOfflineThresholdSeconds: 45
    });
    expect(result.status).toBe("OFFLINE");
  });
});
