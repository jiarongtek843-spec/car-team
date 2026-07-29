import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import { WalletHistoryPage } from "./WalletHistoryPage";
import { http } from "../../api/http";
import type { WalletTransaction } from "../wallet/types";
import type { PagedResult } from "../../types/booking";

vi.mock("../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../api/http")>("../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

function makeTransaction(overrides: Partial<WalletTransaction>): WalletTransaction {
  return {
    id: 1,
    driverId: 1,
    driver: { id: 1, name: "Driver One" },
    bookingId: 10,
    booking: { id: 10, girlName: "Test Girl" },
    legId: 100,
    leg: { id: 100, sequence: 1, pickupLocation: "Mall A", dropoffLocation: "Hotel B", completedAt: "2026-07-28T09:14:39.000Z" },
    transactionType: "LEG_EARNING",
    amountCents: 8500,
    description: null,
    status: "PENDING",
    effectiveDate: "2026-07-28T00:00:00.000Z",
    createdAt: "2026-07-28T09:14:39.000Z",
    settledAt: null,
    settlement: null,
    relatedSettlementId: null,
    relatedSettlement: null,
    ...overrides
  };
}

function pagedResult(data: WalletTransaction[], total = data.length): PagedResult<WalletTransaction> {
  return { data, total, page: 1, pageSize: 20 };
}

describe("WalletHistoryPage（Driver Wallet Transaction History，standalone feature）", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it("会呼叫既有的 /api/driver/wallet/transactions（重用既有 API，不新增记账端点）", async () => {
    vi.mocked(http.get).mockResolvedValue(pagedResult([makeTransaction({})]) as never);
    renderWithProviders(<WalletHistoryPage />);

    await screen.findByText("#10");
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining("/api/driver/wallet/transactions"));
  });

  it("显示 Amount（带正负号）、Booking ID、Pickup、Destination、完成时间、Status", async () => {
    vi.mocked(http.get).mockResolvedValue(pagedResult([makeTransaction({})]) as never);
    renderWithProviders(<WalletHistoryPage />);

    await screen.findByText("#10");
    expect(screen.getByText("+RM 85.00")).toBeInTheDocument();
    expect(screen.getByText("Mall A")).toBeInTheDocument();
    expect(screen.getByText("Hotel B")).toBeInTheDocument();
    expect(screen.getByText(/2026-07-28/)).toBeInTheDocument();
    expect(screen.getByText("待结算")).toBeInTheDocument();
  });

  it("点一笔纪录会打开 Booking 详情（唯读，不呼叫任何新的 API）", async () => {
    vi.mocked(http.get).mockResolvedValue(pagedResult([makeTransaction({})]) as never);
    renderWithProviders(<WalletHistoryPage />);

    const bookingCell = await screen.findByText("#10");
    await userEvent.click(bookingCell);

    expect(await screen.findByText("Booking 详情")).toBeInTheDocument();
    expect(screen.getByText("Pickup：Mall A")).toBeInTheDocument();
    expect(screen.getByText("Destination：Hotel B")).toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("没有资料时显示空状态", async () => {
    vi.mocked(http.get).mockResolvedValue(pagedResult([]) as never);
    renderWithProviders(<WalletHistoryPage />);

    expect(await screen.findByText("还没有任何收入纪录")).toBeInTheDocument();
  });
});
