import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { AppLayout } from "./AppLayout";
import { PERMISSIONS } from "../common/permissions";
import type { AuthUser } from "../types/auth";

vi.mock("../common/useIsMobile", () => ({ useIsMobile: () => true }));

const logout = vi.fn();
let mockUser: AuthUser | null = null;

vi.mock("../modules/auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: vi.fn(), logout })
}));

// AppLayout 本身用 <Outlet/>，测试不需要真的渲染子路由内容，只关心导览列/Drawer 本身。
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, Outlet: () => null };
});

describe("AppLayout（手机导览：Hamburger + Drawer + RBAC 过滤）", () => {
  it("Dispatcher 权限组合：只看得到有权限的项目，Wallet/Settlement/Collection/Company Settings 完全不在 DOM 里（不是被 CSS 藏起来）", async () => {
    mockUser = {
      id: 1,
      username: "dispatcher01",
      role: { key: "DISPATCHER", name: "Dispatcher" },
      permissions: [PERMISSIONS.BOOKING_READ, PERMISSIONS.DISPATCH_READ, PERMISSIONS.DRIVER_READ, PERMISSIONS.GPS_READ],
      driver: null
    };

    renderWithProviders(<AppLayout />);

    // 手机宽度下，Drawer 打开前導覽項目不应该出现在畫面上可以透过一般文字查询找到
    // 的地方（横向 Menu 被拿掉了）——先确认 Hamburger 本身在。
    const hamburger = screen.getByRole("button", { name: "打开导览选单" });
    expect(hamburger).toBeInTheDocument();

    await userEvent.click(hamburger);

    expect(await screen.findByText("Dispatch Center")).toBeInTheDocument();
    expect(screen.getByText("Booking")).toBeInTheDocument();
    expect(screen.getByText("Driver")).toBeInTheDocument();
    expect(screen.getByText("GPS")).toBeInTheDocument();

    expect(screen.queryByText("Wallet")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily Settlement")).not.toBeInTheDocument();
    expect(screen.queryByText("Settlement History")).not.toBeInTheDocument();
    expect(screen.queryByText("Collection")).not.toBeInTheDocument();
    expect(screen.queryByText("Company Settings")).not.toBeInTheDocument();
  });

  it("Owner 权限组合：全部项目都看得到", async () => {
    mockUser = {
      id: 2,
      username: "admin",
      role: { key: "OWNER", name: "Owner" },
      permissions: Object.values(PERMISSIONS),
      driver: null
    };

    renderWithProviders(<AppLayout />);
    await userEvent.click(screen.getByRole("button", { name: "打开导览选单" }));

    expect(await screen.findByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText("Company Settings")).toBeInTheDocument();
  });
});
