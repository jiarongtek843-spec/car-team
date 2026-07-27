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

const OCR_SAMPLE =
  "Date: 26/7\nGirl: Kara\nPick up: 10pm\nTime: 9 hrs\nCollect: 540\nAddress:\n====================\nM vertical tower D\n====================";

async function pasteAndParse(text: string) {
  await userEvent.type(screen.getByPlaceholderText(/贴上派单文字/), text);
  await userEvent.click(screen.getByRole("button", { name: "识别并填入" }));
}

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

  it("Mobile UAT Round 4：移除 Commission 设定区块，只保留简短标题「行程」", () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    expect(screen.queryByText("抽成设定")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Commission Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Commission Value")).not.toBeInTheDocument();
    expect(screen.getByText("行程")).toBeInTheDocument();
  });

  it("Mobile UAT Round 4：去程/回程都不显示 Estimated Duration / Finish Date / Finish Time 栏位", () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    expect(screen.queryAllByLabelText("Estimated Duration (分钟)")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Estimated Finish Date")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Estimated Finish Time")).toHaveLength(0);
  });

  it("Mobile UAT Round 4：去程只有 Pickup Location/Destination/Pickup Date/Pickup Time/时间未定", () => {
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    expect(screen.getAllByLabelText("上车地点").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("下车地点").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Pickup Date").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Pickup Time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("时间未定").length).toBeGreaterThan(0);
  });

  it("Mobile UAT Round 3+4：OCR 的 Duration 用来自动算回程 Pickup Date/Time，正确跨午夜进位，且 Duration 不会出现在画面上", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 47, girlName: "Kara" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await pasteAndParse(OCR_SAMPLE);

    // Duration 解析成功（回程时间才算得出来），但不会渲染成任何可见栏位。
    expect(screen.queryAllByLabelText("Estimated Duration (分钟)")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const legs = (payload as { legs: { legType: string; scheduledAt?: string; estimatedDurationMinutes?: number }[] }).legs;
    const outboundLeg = legs[0];
    const returnLeg = legs[1];

    // 26/7 22:00 + 9 小时 = 27/7 07:00——正确跨了午夜进位到隔天。
    const returnAt = new Date(returnLeg.scheduledAt!);
    expect(returnAt.getDate()).toBe(27);
    expect(returnAt.getHours()).toBe(7);
    expect(returnAt.getMinutes()).toBe(0);
    // Duration 仍然当成 Booking metadata 送给后端（只是不显示在表单上）。
    expect(outboundLeg.estimatedDurationMinutes).toBe(540);
  });

  it("Mobile UAT Round 4：去程 Pickup Time 手动再改一次，回程时间（手动覆盖前）会跟着重新计算", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 48, girlName: "Kara" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await pasteAndParse(OCR_SAMPLE);

    const pickupTimeInputs = screen.getAllByPlaceholderText("选择时间");
    await userEvent.clear(pickupTimeInputs[0]);
    await userEvent.type(pickupTimeInputs[0], "20:00{Enter}");

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const returnLeg = (payload as { legs: { legType: string; scheduledAt?: string }[] }).legs[1];
    const returnAt = new Date(returnLeg.scheduledAt!);
    // 26/7 20:00 + 9 小时 = 27/7 05:00。
    expect(returnAt.getDate()).toBe(27);
    expect(returnAt.getHours()).toBe(5);
    expect(returnAt.getMinutes()).toBe(0);
  });

  it("Mobile UAT Round 4：手动改过回程 Pickup Time 之后，去程时间再变也不会覆盖回去", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 49, girlName: "Kara" });
    renderWithProviders(<CreateBookingModal open onClose={() => {}} />, { route: "/" });

    await pasteAndParse(OCR_SAMPLE);

    const pickupTimeInputs = screen.getAllByPlaceholderText("选择时间");
    // 手动把回程 Pickup Time 改成 09:30（这个栏位已经被自动算过一次，要先清空再输入）。
    await userEvent.clear(pickupTimeInputs[1]);
    await userEvent.type(pickupTimeInputs[1], "09:30{Enter}");

    // 去程时间再变一次，回程手动设定的时间不该被覆盖。
    await userEvent.clear(pickupTimeInputs[0]);
    await userEvent.type(pickupTimeInputs[0], "18:00{Enter}");

    await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));

    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [, payload] = vi.mocked(http.post).mock.calls[0];
    const returnLeg = (payload as { legs: { legType: string; scheduledAt?: string }[] }).legs[1];
    const returnAt = new Date(returnLeg.scheduledAt!);
    expect(returnAt.getHours()).toBe(9);
    expect(returnAt.getMinutes()).toBe(30);
  });

  it("Mobile UAT Round 3：回程起点默认同步去程终点（手动输入，不透过 OCR）", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 50, girlName: "Return Pickup Sync" });
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
