import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DriverManagementPage } from "./DriverManagementPage";
import { http } from "../../api/http";
import { PERMISSIONS } from "../../common/permissions";
import type { Driver } from "../../types/booking";

vi.mock("../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../api/http")>("../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

// DriverManagementPage 用 PermissionGate 包住操作按钮，PermissionGate 内部要拿到
// AuthContext 才知道目前使用者有哪些权限——这里给一个权限齐全的假 Owner，让操作
// 按钮正常渲染出来，专注测这个测试真正关心的事（Table vs Card）。
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", role: { key: "OWNER", name: "Owner" }, permissions: Object.values(PERMISSIONS), driver: null },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn()
  })
}));

const drivers: Driver[] = [
  {
    id: 1,
    username: "driver01",
    name: "Driver One",
    phone: "0111111111",
    vehiclePlateNumber: "ABC1234",
    remark: null,
    status: "ACTIVE",
    hasActiveLeg: true
  }
];

describe("DriverManagementPage（桌面宽度，既有行为不受影响）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.get).mockResolvedValue(drivers);
  });

  it("桌面宽度下渲染成 Table", async () => {
    renderWithProviders(<DriverManagementPage />);

    await screen.findByText("Driver One");
    expect(document.querySelector("table")).not.toBeNull();
  });
});
