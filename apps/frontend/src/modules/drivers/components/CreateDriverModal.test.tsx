import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { CreateDriverModal } from "./CreateDriverModal";
import { http, ApiError } from "../../../api/http";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

// CreateDriverModal 手机版是全屏 Drawer（ResponsiveModal），不是桌面置中的 Modal——
// 这个 mock 强制 isMobile=true，专门验证「手机版 Drawer 上的表单可以正常填写、
// 送出、拿到 API 结果」，对应 driver-earnings 那次修复之前 CreateDriverModal
// 从未真的转成 ResponsiveModal、Submit 按钮在真实 iPhone 上被键盘遮住的那个 Bug。
vi.mock("../../../common/useIsMobile", () => ({ useIsMobile: () => true }));

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Full Name"), "Mobile Test Driver");
  await userEvent.type(screen.getByLabelText("Username"), "mobiletest01");
  await userEvent.type(screen.getByLabelText("Password"), "TestPass123");
  await userEvent.click(screen.getByRole("button", { name: /建\s*立/ }));
}

describe("CreateDriverModal（手机版 Drawer）", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("渲染成全屏 Drawer 而不是桌面 Modal", () => {
    renderWithProviders(<CreateDriverModal open onClose={() => {}} />);
    expect(document.querySelector(".ant-drawer")).not.toBeNull();
    expect(document.querySelector(".ant-modal")).toBeNull();
  });

  it("填写表单送出成功后呼叫 API 并关闭", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: 1, name: "Mobile Test Driver" });
    const onClose = vi.fn();
    renderWithProviders(<CreateDriverModal open onClose={onClose} />);

    await fillAndSubmit();

    await waitFor(() => expect(http.post).toHaveBeenCalledWith(
      "/api/drivers",
      expect.objectContaining({ name: "Mobile Test Driver", username: "mobiletest01", password: "TestPass123" })
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("API 失败时显示错误讯息，不是无反应，Drawer 也不会关闭", async () => {
    // antd 的 message.xxx() 是挂进独立 portal 的静态方法，在 jsdom 底下渲染时机
    // 不保证能被 findByText 稳定抓到（这是 antd 测试环境常见的已知限制，不是我们
    // 代码的问题）——用 spy 直接断言「有没有被呼叫、呼叫时带的文字对不对」，
    // 比断言实际渲染出来的 DOM 更稳定可靠。
    const errorSpy = vi.spyOn(message, "error").mockImplementation(() => "" as unknown as ReturnType<typeof message.error>);
    vi.mocked(http.post).mockRejectedValueOnce(new ApiError(409, "Username 已经被使用"));
    const onClose = vi.fn();
    renderWithProviders(<CreateDriverModal open onClose={onClose} />);

    await fillAndSubmit();

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("Username 已经被使用"));
    expect(onClose).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
