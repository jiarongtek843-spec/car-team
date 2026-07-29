import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { AdminNotificationBell } from "./AdminNotificationBell";
import { http } from "../../../api/http";
import { PERMISSIONS } from "../../../common/permissions";
import type { Notification } from "../types";
import type { PagedResult } from "../../../types/booking";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockUser: { role: { key: string }; permissions: string[] } | null = {
  role: { key: "OWNER" },
  permissions: [PERMISSIONS.NOTIFICATION_READ]
};

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: vi.fn(), logout: vi.fn() })
}));

function makeNotification(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    audience: "ADMIN",
    driverId: null,
    type: "BOOKING_CREATED",
    title: "Booking Created",
    message: "Booking #10 has been created",
    isRead: false,
    readAt: null,
    relatedBookingId: null,
    relatedUrl: null,
    sourceActivityId: 100,
    createdAt: "2026-07-29T10:00:00.000Z",
    ...overrides
  };
}

function paged(data: Notification[], total = data.length): PagedResult<Notification> {
  return { data, total, page: 1, pageSize: 20 };
}

function isCountQuery(url: string) {
  return url.includes("pageSize=1") && !url.includes("pageSize=100");
}

describe("AdminNotificationBell", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.patch).mockReset();
    mockNavigate.mockReset();
    mockUser = { role: { key: "OWNER" }, permissions: [PERMISSIONS.NOTIFICATION_READ] };
  });

  it("没有 notification:read 权限时不渲染任何东西", () => {
    mockUser = { role: { key: "OWNER" }, permissions: [] };
    vi.mocked(http.get).mockResolvedValue(paged([]) as never);

    const { container } = renderWithProviders(<AdminNotificationBell />);

    expect(container).toBeEmptyDOMElement();
  });

  it("显示未读数量徽章", async () => {
    vi.mocked(http.get).mockResolvedValue(paged([], 3) as never);

    renderWithProviders(<AdminNotificationBell />);

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
  });

  it("点击铃铛开启 Drawer，显示 Title/Message/Time/已读状态，且新到旧排序", async () => {
    const notifications = [
      makeNotification({ id: 1, title: "第一笔", message: "内容一", createdAt: "2026-07-29T10:00:00.000Z" }),
      makeNotification({ id: 2, title: "第二笔", message: "内容二", isRead: true, createdAt: "2026-07-29T09:00:00.000Z" })
    ];
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (isCountQuery(url)) return Promise.resolve(paged([], 1) as never);
      return Promise.resolve(paged(notifications) as never);
    });

    renderWithProviders(<AdminNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("第一笔")).toBeInTheDocument();
    expect(within(drawer).getByText("内容一")).toBeInTheDocument();
    expect(within(drawer).getByText("2026-07-29 18:00")).toBeInTheDocument();

    const titles = within(drawer)
      .getAllByText(/第一笔|第二笔/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["第一笔", "第二笔"]);
  });

  it("点击未读通知：会标为已读，且有 relatedBookingId 时会导航过去", async () => {
    const notification = makeNotification({ id: 5, relatedBookingId: 42 });
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (isCountQuery(url)) return Promise.resolve(paged([], 1) as never);
      return Promise.resolve(paged([notification]) as never);
    });
    vi.mocked(http.patch).mockResolvedValue({ ...notification, isRead: true } as never);

    renderWithProviders(<AdminNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));
    const drawer = await screen.findByRole("dialog");
    await userEvent.click(within(drawer).getByText(notification.title));

    await waitFor(() => expect(http.patch).toHaveBeenCalledWith("/api/notifications/5/read"));
    expect(mockNavigate).toHaveBeenCalledWith("/bookings/42");
  });

  it("Mark All as Read：逐笔呼叫既有的 mark-read API，不呼叫任何新端点", async () => {
    const unread = [makeNotification({ id: 1 }), makeNotification({ id: 2 })];
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (isCountQuery(url)) return Promise.resolve(paged([], 2) as never);
      if (url.includes("isRead=false")) return Promise.resolve(paged(unread, 2) as never);
      return Promise.resolve(paged(unread) as never);
    });
    vi.mocked(http.patch).mockResolvedValue({} as never);

    renderWithProviders(<AdminNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "全部标为已读" }));

    await waitFor(() => {
      expect(http.patch).toHaveBeenCalledWith("/api/notifications/1/read");
      expect(http.patch).toHaveBeenCalledWith("/api/notifications/2/read");
    });
  });

  it("没有通知时显示空状态", async () => {
    vi.mocked(http.get).mockResolvedValue(paged([]) as never);

    renderWithProviders(<AdminNotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "通知" }));

    expect(await screen.findByText("还没有任何通知")).toBeInTheDocument();
  });
});
