import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DispatchCenterPage } from "./DispatchCenterPage";
import { http } from "../../api/http";

vi.mock("../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../api/http")>("../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

// Dispatch Center 的 4 个 Tab（Waiting/Drivers/Active/Completed）只在手机版才出现——
// 桌面维持原本左右两栏 + 一个 Drawer，见 DispatchCenterPage.tsx 的注解。
vi.mock("../../common/useIsMobile", () => ({ useIsMobile: () => true }));

describe("DispatchCenterPage Completed Tab（Mobile UX + Scheduling Sprint）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.get).mockImplementation((path: string) => {
      if (path.startsWith("/api/admin/dispatch/statistics")) {
        return Promise.resolve({
          waitingBookings: 0,
          assigned: 0,
          inProgress: 0,
          completedToday: 3,
          onlineDrivers: 0,
          offlineDrivers: 0
        } as never);
      }
      if (path.startsWith("/api/admin/dispatch/waiting-bookings")) return Promise.resolve([] as never);
      if (path.startsWith("/api/admin/dispatch/drivers")) return Promise.resolve([] as never);
      throw new Error(`unexpected path ${path}`);
    });
  });

  it("点击 Completed Today 数字会切到 Completed Tab，并带 filter=COMPLETED 打 API", async () => {
    renderWithProviders(<DispatchCenterPage />);

    const completedCard = await screen.findByText("Completed Today");
    await userEvent.click(completedCard);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Completed", selected: true })).toBeInTheDocument());

    await waitFor(() =>
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining("filter=COMPLETED"))
    );
  });

  it("Completed Tab 没有资料时显示「这一天没有已完成的 Leg」，不是跟 Waiting 共用的空状态文字", async () => {
    renderWithProviders(<DispatchCenterPage />);

    const completedTab = await screen.findByRole("tab", { name: "Completed" });
    await userEvent.click(completedTab);

    expect(await screen.findByText("这一天没有已完成的 Leg")).toBeInTheDocument();
  });
});
