import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { DriverStatusBoard } from "./DriverStatusBoard";
import { http } from "../../../api/http";
import type { DriverPresenceEntry } from "../types";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

function makeEntry(overrides: Partial<DriverPresenceEntry>): DriverPresenceEntry {
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

describe("DriverStatusBoard（Driver Presence 唯读展示，重用既有 /api/admin/driver-presence）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it("显示 Driver Name / Status / Current Booking / Last Seen", async () => {
    vi.mocked(http.get).mockResolvedValue([
      makeEntry({
        driverId: 1,
        driverName: "Driver One",
        status: "ON_TRIP",
        currentBooking: { id: 10, girlName: "Test Girl" }
      })
    ] as never);

    renderWithProviders(<DriverStatusBoard />);

    expect(await screen.findByText("Driver One")).toBeInTheDocument();
    expect(screen.getByText("On Trip")).toBeInTheDocument();
    expect(screen.getByText("#10 Test Girl")).toBeInTheDocument();
    expect(screen.getByText("2026-07-30 18:00")).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith("/api/admin/driver-presence");
  });

  it("没有 Current Booking 时显示 -", async () => {
    vi.mocked(http.get).mockResolvedValue([makeEntry({ status: "AVAILABLE", currentBooking: null })] as never);

    renderWithProviders(<DriverStatusBoard />);

    await screen.findByText("Driver One");
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("从未上线的司机 Last Seen 显示对应文字", async () => {
    vi.mocked(http.get).mockResolvedValue([makeEntry({ lastSeenAt: null })] as never);

    renderWithProviders(<DriverStatusBoard />);

    expect(await screen.findByText("从未上线")).toBeInTheDocument();
  });

  it("空列表时显示空状态", async () => {
    vi.mocked(http.get).mockResolvedValue([] as never);

    renderWithProviders(<DriverStatusBoard />);

    expect(await screen.findByText("Driver Status")).toBeInTheDocument();
  });
});
