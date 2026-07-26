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

  it("Mobile UAT Round 3：移除长说明文字，只保留简短标题", async () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    expect(screen.getByText("抽成设定")).toBeInTheDocument();
    expect(screen.getByText("行程")).toBeInTheDocument();
    expect(screen.queryByText(/不填就用公司默认值/)).not.toBeInTheDocument();
    expect(screen.queryByText(/默认已建立去程\/回程/)).not.toBeInTheDocument();
    expect(screen.queryByText(/司机收入会在建立后依 Driver Pool 自动平分/)).not.toBeInTheDocument();
  });

  it("Mobile UAT Round 3：回程 Leg 不显示 Estimated Duration / Finish Date / Finish Time 栏位", () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    // 只有去程会显示这三个栏位，回程完全不该出现。
    expect(screen.getAllByLabelText("Estimated Duration (分钟)")).toHaveLength(1);
    expect(screen.getAllByLabelText("Estimated Finish Date")).toHaveLength(1);
    expect(screen.getAllByLabelText("Estimated Finish Time")).toHaveLength(1);
  });

  it("Mobile UAT Round 3：回程 Pickup Date/Time 依「去程 Pickup + Duration」自动算，正确跨午夜进位", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 47, girlName: "Return Auto Calc" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Return Auto Calc");

    const pickupDateInputs = screen.getAllByPlaceholderText("选择日期");
    await userEvent.type(pickupDateInputs[0], "2026-07-26{Enter}");
    const pickupTimeInputs = screen.getAllByPlaceholderText("选择时间");
    await userEvent.type(pickupTimeInputs[0], "22:00{Enter}");

    const durationInput = screen.getByLabelText("Estimated Duration (分钟)");
    await userEvent.type(durationInput, "540"); // 9 小时

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const returnLeg = (payload as { legs: { legType: string; scheduledAt?: string }[] }).legs[1];
    expect(returnLeg.legType).toBe("RETURN");
    const returnAt = new Date(returnLeg.scheduledAt!);
    // 26/07 22:00 + 9 小时 = 27/07 07:00——正确跨了午夜进位到隔天。
    expect(returnAt.getDate()).toBe(27);
    expect(returnAt.getHours()).toBe(7);
    expect(returnAt.getMinutes()).toBe(0);
  });

  it("Mobile UAT Round 3：手动改过回程 Pickup Time 之后，去程时间再变也不会覆盖回去", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 48, girlName: "Return Manual Override" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Return Manual Override");

    const pickupDateInputs = screen.getAllByPlaceholderText("选择日期");
    await userEvent.type(pickupDateInputs[0], "2026-07-26{Enter}");
    const pickupTimeInputs = screen.getAllByPlaceholderText("选择时间");
    await userEvent.type(pickupTimeInputs[0], "22:00{Enter}");

    const durationInput = screen.getByLabelText("Estimated Duration (分钟)");
    await userEvent.type(durationInput, "540");

    // 手动把回程 Pickup Time 改成 09:30（这个栏位已经被自动算过一次，要先清空再输入）。
    await userEvent.clear(pickupTimeInputs[1]);
    await userEvent.type(pickupTimeInputs[1], "09:30{Enter}");

    // 去程时间再变一次，回程手动设定的时间不该被覆盖。
    await userEvent.clear(durationInput);
    await userEvent.type(durationInput, "600");

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const returnLeg = (payload as { legs: { legType: string; scheduledAt?: string }[] }).legs[1];
    const returnAt = new Date(returnLeg.scheduledAt!);
    expect(returnAt.getHours()).toBe(9);
    expect(returnAt.getMinutes()).toBe(30);
  });

  it("Mobile UAT Round 3：回程起点默认同步去程终点（手动输入，不透过 OCR）", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 49, girlName: "Return Pickup Sync" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await userEvent.type(screen.getByLabelText("Girl 姓名"), "Return Pickup Sync");

    const dropoffInputs = screen.getAllByLabelText("下车地点");
    await userEvent.type(dropoffInputs[0], "Element by marriot");

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const returnLeg = (payload as { legs: { legType: string; pickupLocation?: string }[] }).legs[1];
    expect(returnLeg.pickupLocation).toBe("Element by marriot");
  });
});
