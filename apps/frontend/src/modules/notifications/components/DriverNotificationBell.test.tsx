import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { DriverNotificationBell } from "./DriverNotificationBell";
import { http } from "../../../api/http";
import { PERMISSIONS } from "../../../common/permissions";
import type { Notification } from "../types";
import type { PagedResult } from "../../../types/booking";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

let mockUser: { permissions: string[] } | null = { permissions: [PERMISSIONS.DRIVER_NOTIFICATION_SELF] };

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: vi.fn(), logout: vi.fn() })
}));

function makeNotification(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    audience: "DRIVER",
    driverId: 7,
    type: "DRIVER_ACCEPTED_LEG",
    title: "行程已接受",
    message: "你已经接受了这趟行程",
    isRead: false,
    readAt: null,
    relatedBookingId: 42,
    relatedUrl: null,
    sourceActivityId: 200,
    createdAt: "2026-07-29T10:00:00.000Z",
    ...overrides
  };
}

function paged(data: Notification[], total = data.length): PagedResult<Notification> {
  return { data, total, page: 1, pageSize: 20 };
}

describe("DriverNotificationBell", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.patch).mockReset();
    mockUser = { permissions: [PERMISSIONS.DRIVER_NOTIFICATION_SELF] };
  });

  it("呼叫既有的 /api/driver/notifications 端点（不是 Admin 端）", async () => {
    vi.mocked(http.get).mockResolvedValue(paged([]) as never);

    renderWithProviders(<DriverNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));

    await waitFor(() =>
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining("/api/driver/notifications"))
    );
    expect(vi.mocked(http.get).mock.calls.some(([url]) => (url as string).includes("/api/notifications?"))).toBe(
      false
    );
  });

  it("点击未读通知会标为已读，但不会导航（司机端没有 Booking 详情页）", async () => {
    const notification = makeNotification({});
    vi.mocked(http.get).mockResolvedValue(paged([notification]) as never);
    vi.mocked(http.patch).mockResolvedValue({ ...notification, isRead: true } as never);

    renderWithProviders(<DriverNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));
    await userEvent.click(await screen.findByText(notification.title));

    await waitFor(() => expect(http.patch).toHaveBeenCalledWith("/api/driver/notifications/1/read"));
  });

  it("没有 driverNotification:self 权限时不渲染", () => {
    mockUser = { permissions: [] };
    vi.mocked(http.get).mockResolvedValue(paged([]) as never);

    const { container } = renderWithProviders(<DriverNotificationBell />);

    expect(container).toBeEmptyDOMElement();
  });
});
