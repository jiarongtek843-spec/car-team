import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { BookingTimelineCard } from "./BookingTimelineCard";
import { http } from "../../../api/http";
import type { BookingTimeline } from "../timelineTypes";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

describe("BookingTimelineCard（Booking Timeline，read-only feature）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it("呼叫既有的 /api/bookings/:id/timeline endpoint", async () => {
    const timeline: BookingTimeline = {
      bookingId: 10,
      girlName: "Test Girl",
      events: [
        { type: "BOOKING_CREATED", label: "Booking Created", timestamp: "2026-07-29T01:00:00.000Z", driver: null, legId: null, legSequence: null, legType: null }
      ]
    };
    vi.mocked(http.get).mockResolvedValue(timeline as never);

    renderWithProviders(<BookingTimelineCard bookingId={10} />);

    await screen.findByText("Booking Created");
    expect(http.get).toHaveBeenCalledWith("/api/bookings/10/timeline");
  });

  it("依时间顺序显示 Status/Timestamp/Driver，Leg 事件带上 Leg 标签", async () => {
    const timeline: BookingTimeline = {
      bookingId: 10,
      girlName: "Test Girl",
      events: [
        { type: "BOOKING_CREATED", label: "Booking Created", timestamp: "2026-07-29T01:00:00.000Z", driver: null, legId: null, legSequence: null, legType: null },
        {
          type: "DRIVER_ACCEPTED",
          label: "Driver Accepted",
          timestamp: "2026-07-29T02:00:00.000Z",
          driver: { id: 1, name: "Driver One" },
          legId: 100,
          legSequence: 1,
          legType: "OUTBOUND"
        }
      ]
    };
    vi.mocked(http.get).mockResolvedValue(timeline as never);

    renderWithProviders(<BookingTimelineCard bookingId={10} />);

    await screen.findByText(/Driver Accepted（去程 #1）/);
    expect(screen.getByText("Driver One")).toBeInTheDocument();
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it("没有事件时显示空状态", async () => {
    vi.mocked(http.get).mockResolvedValue({ bookingId: 10, girlName: "Test Girl", events: [] } as never);

    renderWithProviders(<BookingTimelineCard bookingId={10} />);

    expect(await screen.findByText("还没有任何事件纪录")).toBeInTheDocument();
  });
});
