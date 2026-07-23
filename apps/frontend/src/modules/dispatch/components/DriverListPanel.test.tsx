import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { DriverListPanel } from "./DriverListPanel";
import { http } from "../../../api/http";
import type { DispatchDriver, DispatchWaitingLeg } from "../types";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

const driver: DispatchDriver = {
  driver: { id: 5, name: "Driver Five", phone: "0123456789", vehiclePlateNumber: "ABC123" },
  gpsStatus: "ONLINE",
  secondsSinceUpdate: 10,
  location: { latitude: 1.1, longitude: 2.2 },
  currentJobs: 0,
  pendingJobs: 0,
  completedToday: 2,
  workloadStatus: "IDLE"
};

const selectedLeg: DispatchWaitingLeg = {
  legId: 9,
  bookingId: 3,
  girlName: "Test Girl",
  bookingStatus: "PENDING",
  sequence: 1,
  legType: "OUTBOUND",
  pickupLocation: "A",
  dropoffLocation: "B",
  scheduledAt: null,
  completedAt: null,
  bookingCreatedAt: new Date().toISOString(),
  priority: "NORMAL",
  status: "PENDING",
  rejectionReason: null,
  driver: null
};

describe("DriverListPanel（Dispatch 手机 Assign）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.post).mockReset();
    vi.mocked(http.get).mockResolvedValue([driver]);
  });

  it("选好 Leg 后点 Driver 的 Assign 按钮会呼叫指派 API 并在成功后通知外层", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({});
    const onAssigned = vi.fn();
    renderWithProviders(<DriverListPanel selectedLeg={selectedLeg} onAssigned={onAssigned} />);

    await screen.findByText("Driver Five");
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(http.post).toHaveBeenCalledWith("/api/bookings/3/legs/9/assign", { driverId: 5 })
    );
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
  });

  it("没有选 Leg 时不会显示 Assign 按钮，避免误触", async () => {
    renderWithProviders(<DriverListPanel selectedLeg={null} onAssigned={() => {}} />);

    await screen.findByText("Driver Five");
    expect(screen.queryByRole("button", { name: "Assign" })).not.toBeInTheDocument();
  });
});
