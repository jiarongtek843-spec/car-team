import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { BookingListPage } from "./BookingListPage";

// Critical Bug 2 + Mobile UX Sprint 回归测试：手机版 Booking Search 之前用 antd 的
// Input.Search，内建的紧凑搜索按钮宽度固定，窄屏（320/375/390/430px）下会把姓名输入框
// 挤得很窄、整体不协调。现在改用共享的 ResponsiveFilterBar（见 common/ResponsiveFilterBar.tsx）：
// 手机版用 index.css 的 .responsive-filter-bar--mobile 规则强制每个直接子元素 width:100%，
// jsdom 不会真的套用外部 CSS 文件，所以这里验证的是「有没有正确接上这个机制」（vertical
// 排列 + 挂上对应 class name），不是量测实际计算出来的像素宽度。
vi.mock("../../common/useIsMobile", () => ({ useIsMobile: () => true }));

vi.mock("./components/CreateBookingModal", () => ({
  CreateBookingModal: () => null
}));

vi.mock("./hooks", () => ({
  useBookingsQuery: () => ({ data: { data: [], total: 0 }, isLoading: false })
}));

describe("BookingListPage 手机版搜索区（Bug 2 回归测试）", () => {
  it("Status Filter、Girl 姓名输入框、Search 按钮用 ResponsiveFilterBar 垂直排列，不用紧凑的 Input.Search", () => {
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

    // 手机版一定要挂上 ResponsiveFilterBar 的 mobile class + 垂直排列，
    // index.css 才会真的把三个控件强制变成各占一行。
    const filterBar = select!.closest(".responsive-filter-bar--mobile");
    expect(filterBar).not.toBeNull();
    expect(filterBar).toHaveClass("ant-space-vertical");
    expect(filterBar!.contains(input)).toBe(true);
    expect(filterBar!.contains(searchButton)).toBe(true);
  });

  it("Search 按钮触控高度 >= 44px（手机触控目标最小尺寸）", () => {
    renderWithProviders(<BookingListPage />);
    const searchButton = screen.getByRole("button", { name: "search搜索" });
    expect(parseInt(searchButton.style.height, 10)).toBeGreaterThanOrEqual(44);
  });
});
