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

  it("Mobile UAT Round 2：去程默认起点 28、回程默认终点 28，会一起送到后端", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 45, girlName: "Default Location Test" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Default Location Test");
    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() =>
      expect(http.post).toHaveBeenCalledWith(
        "/api/bookings",
        expect.objectContaining({
          legs: [
            expect.objectContaining({ legType: "OUTBOUND", pickupLocation: "28" }),
            expect.objectContaining({ legType: "RETURN", dropoffLocation: "28" })
          ]
        })
      )
    );
  });

  it("Mobile UAT Round 2：手动改过 Estimated Finish Time 之后，Duration 再改也不会把它覆盖回去", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 46, girlName: "Manual Finish Test" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Manual Finish Test");

    const pickupDateInputs = screen.getAllByPlaceholderText("选择日期");
    await userEvent.type(pickupDateInputs[0], "2026-08-01{Enter}");
    const pickupTimeInputs = screen.getAllByPlaceholderText("选择时间");
    await userEvent.type(pickupTimeInputs[0], "09:00{Enter}");

    const durationInputs = screen.getAllByLabelText("Estimated Duration (分钟)");
    await userEvent.type(durationInputs[0], "180");

    // Duration=180 从 09:00 起算，自动算出的 Finish Time 应该是 12:00；手动改成 23:59。
    const finishTimeInputs = screen.getAllByPlaceholderText("自动算好，可手动改").filter((el) => el.getAttribute("type") !== "date");
    const finishTimeInput = finishTimeInputs.find((el) => el.id?.includes("estimatedFinishTime")) ?? finishTimeInputs[1];
    await userEvent.clear(finishTimeInput);
    await userEvent.type(finishTimeInput, "23:59{Enter}");

    // 再改一次 Duration，手动设定过的 Finish Time 不该被自动重算覆盖掉。
    await userEvent.clear(durationInputs[0]);
    await userEvent.type(durationInputs[0], "240");

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const outboundLeg = (payload as { legs: { legType: string; estimatedFinishAt?: string }[] }).legs[0];
    expect(outboundLeg.legType).toBe("OUTBOUND");
    // toISOString() 一律是 UTC，不能直接比对字串里有没有 "23:59"——用本地时间的
    // 小时/分钟来确认，才不会受测试环境时区影响判断结果。
    const finishAt = new Date(outboundLeg.estimatedFinishAt!);
    expect(finishAt.getHours()).toBe(23);
    expect(finishAt.getMinutes()).toBe(59);
  });
});
