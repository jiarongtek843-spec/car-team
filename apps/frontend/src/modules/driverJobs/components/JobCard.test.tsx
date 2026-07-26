import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { JobCard } from "./JobCard";
import { http } from "../../../api/http";
import type { DriverLeg } from "../types";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

function makeLeg(overrides: Partial<DriverLeg>): DriverLeg {
  return {
    id: 1,
    bookingId: 10,
    sequence: 1,
    legType: "OUTBOUND",
    driverId: 1,
    pickupLocation: "A",
    dropoffLocation: "B",
    scheduledAt: null,
    estimatedDurationMinutes: null,
    estimatedFinishAt: null,
    notes: null,
    status: "ASSIGNED",
    rejectionReason: null,
    assignedAt: null,
    acceptedAt: null,
    driverArrivingAt: null,
    passengerOnBoardAt: null,
    completedAt: null,
    rejectedAt: null,
    driverEarningCents: null,
    walletStatus: null,
    settlementReference: null,
    booking: { id: 10, girlName: "Test Girl", totalAmountCents: 0, notes: null, status: "IN_PROGRESS" },
    ...overrides
  };
}

describe("JobCard（Driver 手机接单流程）", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("ASSIGNED 状态点 Accept 会呼叫 accept API", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({});
    renderWithProviders(<JobCard leg={makeLeg({ status: "ASSIGNED" })} onReject={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/api/driver/legs/1/accept"));
  });

  it("PASSENGER_ON_BOARD 状态点 Mark as Completed 会先跳出确认，不会立刻发送请求", async () => {
    renderWithProviders(<JobCard leg={makeLeg({ status: "PASSENGER_ON_BOARD" })} onReject={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Mark as Completed" }));

    expect(screen.getByText("确定要标记这趟行程已完成吗？")).toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("确认 Popconfirm 之后才真的呼叫 complete API（危险操作二次确认）", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({});
    renderWithProviders(<JobCard leg={makeLeg({ status: "PASSENGER_ON_BOARD" })} onReject={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Mark as Completed" }));
    await userEvent.click(screen.getByRole("button", { name: "确定完成" }));

    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/api/driver/legs/1/complete"));
  });
});
