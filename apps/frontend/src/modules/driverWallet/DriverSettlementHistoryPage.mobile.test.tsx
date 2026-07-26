import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DriverSettlementHistoryPage } from "./DriverSettlementHistoryPage";
import { http } from "../../api/http";
import type { Settlement } from "../settlement/types";

vi.mock("../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../api/http")>("../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

// 跟 DriverManagementPage.mobile.test.tsx 一样的理由：useIsMobile 在页面载入时就静态
// import 绑定了，同一个档案很难可靠切换手机/桌面情境，固定用手机版。
vi.mock("../../common/useIsMobile", () => ({ useIsMobile: () => true }));

function makeSettlement(overrides: Partial<Settlement>): Settlement {
  return {
    id: 1,
    reference: "SET-20260726-0001",
    driverId: 1,
    driver: { id: 1, name: "Driver One" },
    periodStart: "2026-07-24T00:00:00.000Z",
    periodEnd: "2026-07-26T00:00:00.000Z",
    status: "COMPLETED",
    walletAmountCents: 38250,
    collectionAmountCents: 0,
    netAmountCents: 38250,
    createdAt: "2026-07-27T00:13:26.000Z",
    createdByUser: null,
    voidedAt: null,
    voidedByUser: null,
    voidReason: null,
    ...overrides
  };
}

describe("DriverSettlementHistoryPage（Mobile UAT Round 3）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it("手机宽度下渲染成 Card List，不是 Table，也没有横向滚动", async () => {
    vi.mocked(http.get).mockResolvedValue([makeSettlement({})] as never);
    renderWithProviders(<DriverSettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".ant-card")).not.toBeNull();
  });

  it("Bug Fix：有效的 createdAt 会正确格式化，不是 Invalid Date", async () => {
    vi.mocked(http.get).mockResolvedValue([makeSettlement({})] as never);
    renderWithProviders(<DriverSettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
  });

  it("Bug Fix：createdAt 缺失（null）时显示 -，不是 Invalid Date", async () => {
    vi.mocked(http.get).mockResolvedValue([
      makeSettlement({ createdAt: null as unknown as string })
    ] as never);
    renderWithProviders(<DriverSettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });
});
