import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { SettlementHistoryPage } from "./SettlementHistoryPage";
import { http } from "../../api/http";
import { PERMISSIONS } from "../../common/permissions";
import type { Settlement } from "./types";

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

describe("SettlementHistoryPage（Admin，Mobile UAT Round 3）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/drivers")) return Promise.resolve([{ id: 1, name: "Driver One" }] as never);
      return Promise.resolve({ data: [makeSettlement({})], total: 1, page: 1, pageSize: 20 } as never);
    });
  });

  it("手机宽度下渲染成 Card List，不是 Table，也没有横向滚动", async () => {
    renderWithProviders(<SettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".ant-card")).not.toBeNull();
  });

  it("Bug Fix：Period/Created At 都正确格式化，不是 Invalid Date", async () => {
    renderWithProviders(<SettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
  });

  it("Bug Fix：periodEnd 缺失（null）时显示 -，不是 Invalid Date", async () => {
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/drivers")) return Promise.resolve([{ id: 1, name: "Driver One" }] as never);
      return Promise.resolve({
        data: [makeSettlement({ periodEnd: null as unknown as string })],
        total: 1,
        page: 1,
        pageSize: 20
      } as never);
    });
    renderWithProviders(<SettlementHistoryPage />);

    await screen.findByText("SET-20260726-0001");
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
  });
});
