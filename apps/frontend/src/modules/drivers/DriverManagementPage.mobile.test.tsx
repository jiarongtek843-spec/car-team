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

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", role: { key: "OWNER", name: "Owner" }, permissions: Object.values(PERMISSIONS), driver: null },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn()
  })
}));

// 独立成一个档案（而不是在同一个档案内用 vi.doMock 切换），是因为 useIsMobile
// 在 DriverManagementPage 载入时就已经被静态 import 绑定，模组快取下同一个测试
// 档案里很难可靠地在「手机」跟「桌面」两种情境之间切换 mock——拆成两个档案，
// 各自在档案最顶层用 vi.mock（会被 hoist）固定一种情境，才不会互相污染。
vi.mock("../../common/useIsMobile", () => ({ useIsMobile: () => true }));

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

describe("DriverManagementPage（手机版 Card View，对应「表格没有适配手机」的 Bug 报告）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.get).mockResolvedValue(drivers);
  });

  it("手机宽度下渲染成 Card List，不是 Table", async () => {
    renderWithProviders(<DriverManagementPage />);

    await screen.findByText("Driver One");
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".ant-card")).not.toBeNull();
    // MobileCardList 用同一份 columns 定义渲染每个欄位的 label:value，Username/
    // Full Name/Phone/Vehicle Plate 应该都要在——不是只显示部分欄位。
    expect(screen.getByText("driver01")).toBeInTheDocument();
    expect(screen.getByText("0111111111")).toBeInTheDocument();
    expect(screen.getByText("ABC1234")).toBeInTheDocument();
  });
});
