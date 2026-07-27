import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { EditLegModal } from "./EditLegModal";
import { http } from "../../../api/http";
import type { Leg } from "../../../types/booking";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

function makeLeg(overrides: Partial<Leg>): Leg {
  return {
    id: 1,
    bookingId: 10,
    legType: "OUTBOUND",
    sequence: 1,
    status: "PENDING",
    driverId: null,
    driver: null,
    pickupLocation: "28",
    dropoffLocation: "M vertical tower D",
    scheduledAt: "2026-07-27T01:30:00.000Z",
    earningAllocationCents: 0,
    earningAllocationManual: false,
    ...overrides
  } as Leg;
}

describe("EditLegModal（Mobile UAT Round 4：只保留 Pickup Location/Destination/Pickup Date/Time）", () => {
  beforeEach(() => {
    vi.mocked(http.patch).mockReset();
  });

  it("不显示 Estimated Duration / Finish Date / Finish Time 栏位", () => {
    renderWithProviders(<EditLegModal bookingId={10} leg={makeLeg({})} onClose={() => {}} />);

    expect(screen.queryByLabelText(/Estimated Duration/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Estimated Finish Date/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Estimated Finish Time/)).not.toBeInTheDocument();
  });

  it("只保留 Pickup Location/Destination/Pickup Date/Pickup Time/时间未定，两种 Leg 类型都一样", () => {
    renderWithProviders(<EditLegModal bookingId={10} leg={makeLeg({ legType: "RETURN" })} onClose={() => {}} />);

    expect(screen.getByLabelText(/Pickup Location/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Destination/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pickup Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Pickup Time")).toBeInTheDocument();
    expect(screen.getByText("时间未定")).toBeInTheDocument();
  });

  it("储存时只送 pickupLocation/dropoffLocation/scheduledAt，不含 Duration/Finish", async () => {
    vi.mocked(http.patch).mockResolvedValueOnce(makeLeg({}));
    const onClose = vi.fn();
    renderWithProviders(<EditLegModal bookingId={10} leg={makeLeg({})} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /储\s*存/ }));

    await waitFor(() => expect(http.patch).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.patch).mock.calls[0];
    expect(payload).not.toHaveProperty("estimatedDurationMinutes");
    expect(payload).not.toHaveProperty("estimatedFinishAt");
    expect(onClose).toHaveBeenCalled();
  });
});
