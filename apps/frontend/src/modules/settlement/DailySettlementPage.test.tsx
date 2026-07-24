import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DailySettlementPage } from "./DailySettlementPage";
import { http } from "../../api/http";
import { PERMISSIONS } from "../../common/permissions";
import type { Driver } from "../../types/booking";
import type { SettlementPreview } from "./types";

vi.mock("../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../api/http")>("../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

// Confirm Settlement 按钮包在 PermissionGate 里，需要 AuthContext 才能判断权限——
// 这份测试关心的是文案/排除原因/结果显示，给一个权限齐全的假 Owner 让按钮正常渲染即可。
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", role: { key: "OWNER", name: "Owner" }, permissions: Object.values(PERMISSIONS), driver: null },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn()
  })
}));

const drivers: Driver[] = [{ id: 1, name: "Test Driver", phone: null, status: "ACTIVE" }];

function makePreview(overrides: Partial<SettlementPreview>): SettlementPreview {
  return {
    driver: { id: 1, name: "Test Driver" },
    periodStart: "2026-07-24",
    periodEnd: "2026-07-24",
    transactions: [],
    excludedTransactions: [],
    collections: [],
    excludedCollections: [],
    completedLegEarningsCents: 0,
    positiveAdjustmentsCents: 0,
    negativeAdjustmentsCents: 0,
    walletAmountCents: 0,
    collectionAmountCents: 0,
    netAmountCents: 0,
    ...overrides
  };
}

async function selectDriver() {
  const combo = document.querySelector(".ant-select-selector") as HTMLElement;
  await userEvent.click(combo);
  const option = await screen.findByText("Test Driver");
  await userEvent.click(option);
}

describe("DailySettlementPage（Mobile UX + Scheduling Sprint：文案与 Excluded 原因）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.get).mockImplementation((path: string) => {
      if (path.startsWith("/api/drivers")) return Promise.resolve(drivers as never);
      throw new Error(`unexpected path ${path}`);
    });
  });

  it("周期内没有可结算收入、但周期外有资料时：显示新文案 + 排除原因 + 自动选择按钮", async () => {
    vi.mocked(http.get).mockImplementation((path: string) => {
      if (path.startsWith("/api/drivers")) return Promise.resolve(drivers as never);
      if (path.startsWith("/api/admin/settlements/preview")) {
        return Promise.resolve(
          makePreview({
            excludedTransactions: [
              {
                id: 9,
                driverId: 1,
                driver: { id: 1, name: "Test Driver" },
                bookingId: null,
                booking: null,
                legId: null,
                leg: null,
                transactionType: "MANUAL_ADJUSTMENT",
                amountCents: 1000,
                description: null,
                status: "PENDING",
                effectiveDate: "2026-07-20",
                createdAt: "2026-07-20T00:00:00.000Z",
                settledAt: null,
                settlement: null,
                relatedSettlementId: null,
                relatedSettlement: null
              }
            ]
          }) as never
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<DailySettlementPage />);
    await selectDriver();

    expect(await screen.findByText("你选择的日期范围内没有可结算收入。")).toBeInTheDocument();
    expect(screen.getByText("0 笔")).toBeInTheDocument();
    expect(screen.getByText("1 笔")).toBeInTheDocument();
    expect(screen.getByText(/Before Period/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动选择全部未结算日期" })).toBeInTheDocument();
  });

  it("周期内有可结算收入时：显示 Company Pays Driver 结果", async () => {
    vi.mocked(http.get).mockImplementation((path: string) => {
      if (path.startsWith("/api/drivers")) return Promise.resolve(drivers as never);
      if (path.startsWith("/api/admin/settlements/preview")) {
        return Promise.resolve(
          makePreview({
            transactions: [
              {
                id: 10,
                driverId: 1,
                driver: { id: 1, name: "Test Driver" },
                bookingId: null,
                booking: null,
                legId: null,
                leg: null,
                transactionType: "MANUAL_ADJUSTMENT",
                amountCents: 500,
                description: null,
                status: "PENDING",
                effectiveDate: "2026-07-24",
                createdAt: "2026-07-24T00:00:00.000Z",
                settledAt: null,
                settlement: null,
                relatedSettlementId: null,
                relatedSettlement: null
              }
            ],
            positiveAdjustmentsCents: 500,
            walletAmountCents: 500,
            netAmountCents: 500
          }) as never
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<DailySettlementPage />);
    await selectDriver();

    await waitFor(() => expect(screen.getByText("Company Pays Driver RM 5.00")).toBeInTheDocument());
    expect(screen.queryByText("你选择的日期范围内没有可结算收入。")).not.toBeInTheDocument();
  });

  it("Selective Settlement：取消勾选一笔后 Net Settlement 即时重算，Confirm 只送出还勾选的 id", async () => {
    vi.mocked(http.get).mockImplementation((path: string) => {
      if (path.startsWith("/api/drivers")) return Promise.resolve(drivers as never);
      if (path.startsWith("/api/admin/settlements/preview")) {
        return Promise.resolve(
          makePreview({
            transactions: [
              {
                id: 20,
                driverId: 1,
                driver: { id: 1, name: "Test Driver" },
                bookingId: 6,
                booking: { id: 6, girlName: "Girl A" },
                legId: 60,
                leg: { id: 60, sequence: 1 },
                transactionType: "LEG_EARNING",
                amountCents: 5100,
                description: null,
                status: "PENDING",
                effectiveDate: "2026-07-24",
                createdAt: "2026-07-24T00:00:00.000Z",
                settledAt: null,
                settlement: null,
                relatedSettlementId: null,
                relatedSettlement: null
              },
              {
                id: 21,
                driverId: 1,
                driver: { id: 1, name: "Test Driver" },
                bookingId: 7,
                booking: { id: 7, girlName: "Girl B" },
                legId: 70,
                leg: { id: 70, sequence: 1 },
                transactionType: "LEG_EARNING",
                amountCents: 6800,
                description: null,
                status: "PENDING",
                effectiveDate: "2026-07-24",
                createdAt: "2026-07-24T00:00:00.000Z",
                settledAt: null,
                settlement: null,
                relatedSettlementId: null,
                relatedSettlement: null
              }
            ],
            positiveAdjustmentsCents: 0,
            walletAmountCents: 11900,
            netAmountCents: 11900
          }) as never
        );
      }
      throw new Error(`unexpected path ${path}`);
    });
    vi.mocked(http.post).mockResolvedValue({ id: 1, reference: "SET-TEST-0001" } as never);

    renderWithProviders(<DailySettlementPage />);
    await selectDriver();

    // 默认全选：两笔都在，Net Settlement 显示两笔加总 RM119.00。
    await waitFor(() => expect(screen.getByText("Company Pays Driver RM 119.00")).toBeInTheDocument());

    // 取消勾选第一笔（Booking #6 Leg 1 RM51），只剩 Booking #7 Leg 1 RM68。
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);

    await waitFor(() => expect(screen.getByText("Company Pays Driver RM 68.00")).toBeInTheDocument());
    expect(screen.getByText("1 / 2 笔")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Confirm Settlement/ }));

    await waitFor(() =>
      expect(http.post).toHaveBeenCalledWith(
        "/api/admin/settlements",
        expect.objectContaining({ selectedWalletTransactionIds: [21], selectedCollectionIds: [] })
      )
    );
  });
});
