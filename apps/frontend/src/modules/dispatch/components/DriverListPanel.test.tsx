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
    // Phase 1 Driver Eligibility + Ranking Engine 的建议名单跟既有的 Driver List 共用同一支
    // http.get mock，要按 URL 分流，不然建议名单会拿到司机阵列当成 { suggestions: [] } 用，
    // data.suggestions 变成 undefined 直接炸掉。
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url.includes("/suggested-drivers")) {
        return Promise.resolve({
          legId: 9,
          bookingId: 3,
          girlName: "Test Girl",
          pickupLocation: "A",
          dropoffLocation: "B",
          suggestions: []
        } as never);
      }
      return Promise.resolve([driver] as never);
    });
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

  it("Phase 1 建议名单：选好 Leg 后会显示排序好的建议 Driver，点了直接呼叫同一支指派 API", async () => {
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url.includes("/suggested-drivers")) {
        return Promise.resolve({
          legId: 9,
          bookingId: 3,
          girlName: "Test Girl",
          pickupLocation: "A",
          dropoffLocation: "B",
          suggestions: [
            {
              rank: 1,
              driver: { id: 5, name: "Driver Five", vehiclePlateNumber: "ABC123" },
              distanceKm: null,
              gpsStatus: "ONLINE",
              secondsSinceUpdate: 10,
              completedToday: 2
            }
          ]
        } as never);
      }
      return Promise.resolve([driver] as never);
    });
    vi.mocked(http.post).mockResolvedValueOnce({});
    const onAssigned = vi.fn();
    renderWithProviders(<DriverListPanel selectedLeg={selectedLeg} onAssigned={onAssigned} />);

    expect(await screen.findByText("建议 Driver（按距离/空档排序）")).toBeInTheDocument();
    // 没有坐标时退回「今日已完成趟数」当 tie-breaker，不显示假的距离数字。
    expect(await screen.findByText("今日 2 趟")).toBeInTheDocument();

    const assignButtons = await screen.findAllByRole("button", { name: "Assign" });
    await userEvent.click(assignButtons[0]);

    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/api/bookings/3/legs/9/assign", { driverId: 5 }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
  });
});
