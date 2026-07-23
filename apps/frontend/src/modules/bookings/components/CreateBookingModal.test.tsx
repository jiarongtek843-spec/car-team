import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { CreateBookingModal } from "./CreateBookingModal";
import { http } from "../../../api/http";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

vi.mock("../../../common/useIsMobile", () => ({ useIsMobile: () => true }));

describe("CreateBookingModal（手机建单成功，对应 Booking 手机要求）", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("只填必填的 Girl 姓名就能成功建立 Booking", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 42, girlName: "Test Girl" });
    const onClose = vi.fn();
    renderWithProviders(<CreateBookingModal open onClose={onClose} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Test Girl");
    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() =>
      expect(http.post).toHaveBeenCalledWith("/api/bookings", expect.objectContaining({ girlName: "Test Girl" }))
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("没填必填栏位时不会呼叫 API（Validation 挡下）", async () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    expect(await screen.findByText("请输入 Girl 姓名")).toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("默认建立去程(OUTBOUND)+回程(RETURN)两个 Leg，时间没填时送 undefined（显示待确认）", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 43, girlName: "Test Girl 2" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    // 两张 Leg Card 应该已经预设存在（去程/回程），不需要使用者自己点「+新增行程」。
    expect(screen.getByText("去程")).toBeInTheDocument();
    expect(screen.getByText("回程")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Test Girl 2");
    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() =>
      expect(http.post).toHaveBeenCalledWith(
        "/api/bookings",
        expect.objectContaining({
          girlName: "Test Girl 2",
          legs: [
            expect.objectContaining({ legType: "OUTBOUND" }),
            expect.objectContaining({ legType: "RETURN" })
          ]
        })
      )
    );
  });
});
