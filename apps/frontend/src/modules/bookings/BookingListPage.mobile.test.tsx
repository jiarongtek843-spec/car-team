import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { BookingListPage } from "./BookingListPage";

// Critical Bug 2 回归测试：手机版 Booking Search 之前用 antd 的 Input.Search，内建的紧凑
// 搜索按钮宽度固定，窄屏（320/375/390/430px）下会把姓名输入框挤得很窄、整体不协调。
// jsdom 量不出真实的像素宽度/是否横向溢出，所以这里用「用了哪个组件结构」当替代验证：
// 手机版必须是 Status Filter / 姓名 Input / 独立 Search Button 三个各自独占一行的区块，
// 而不是把搜索按钮内嵌在紧凑的 Input.Search 里。
vi.mock("../../common/useIsMobile", () => ({ useIsMobile: () => true }));

vi.mock("./components/CreateBookingModal", () => ({
  CreateBookingModal: () => null
}));

vi.mock("./hooks", () => ({
  useBookingsQuery: () => ({ data: { data: [], total: 0 }, isLoading: false })
}));

describe("BookingListPage 手机版搜索区（Bug 2 回归测试）", () => {
  it("Status Filter、Girl 姓名输入框、Search 按钮各自独占一行，不用紧凑的 Input.Search", () => {
    renderWithProviders(<BookingListPage />);

    // 不能是内建紧凑搜索框（那个组件把输入框跟按钮绑在同一个宽度受限的容器里）。
    expect(document.querySelector(".ant-input-search")).toBeNull();

    const select = document.querySelector(".ant-select");
    const input = screen.getByPlaceholderText("搜索 Girl 姓名");
    // 按钮的可访问名称包含 SearchOutlined 图标的 aria-label（"search"）+ 显示文字（"搜索"）。
    const searchButton = screen.getByRole("button", { name: "search搜索" });

    expect(select).not.toBeNull();
    expect(input).toBeInTheDocument();
    expect(searchButton).toBeInTheDocument();

    // 三者都应该是 100% 宽度的独立区块（垂直堆叠），不是同一行里彼此挤压。
    // allowClear 时 antd 把 width 样式放在外层 .ant-input-affix-wrapper，不是 <input> 本身。
    expect((select as HTMLElement).style.width).toBe("100%");
    const inputWrapper = input.closest(".ant-input-affix-wrapper") as HTMLElement;
    expect(inputWrapper.style.width).toBe("100%");
  });

  it("Search 按钮触控高度 >= 44px（手机触控目标最小尺寸）", () => {
    renderWithProviders(<BookingListPage />);
    const searchButton = screen.getByRole("button", { name: "search搜索" });
    expect(parseInt(searchButton.style.height, 10)).toBeGreaterThanOrEqual(44);
  });
});
