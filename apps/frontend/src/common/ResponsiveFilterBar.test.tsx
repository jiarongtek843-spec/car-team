import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Input, Select } from "antd";

// Mobile UX + Scheduling Sprint：Collection / Dispatch Center / Driver List / Booking List
// 的 Filter Bar 现在全部共用这个组件——这里只测「机制本身」（手机版有没有正确挂上
// 强制 width:100% 的 class + 垂直排列），不测个别页面，各页面各自的测试只要确认有
// 用到 ResponsiveFilterBar 就够了。
describe("ResponsiveFilterBar", () => {
  it("桌面版：不挂 mobile class，维持横向 wrap", async () => {
    vi.resetModules();
    vi.doMock("./useIsMobile", () => ({ useIsMobile: () => false }));
    const { ResponsiveFilterBar: DesktopBar } = await import("./ResponsiveFilterBar");

    const { container } = render(
      <DesktopBar>
        <Select options={[]} />
        <Input />
      </DesktopBar>
    );

    const space = container.querySelector(".ant-space");
    expect(space).not.toBeNull();
    expect(space).not.toHaveClass("responsive-filter-bar--mobile");
    expect(space).toHaveClass("ant-space-horizontal");
    vi.resetModules();
  });

  it("手机版：挂上 responsive-filter-bar--mobile class 并垂直排列", async () => {
    vi.resetModules();
    vi.doMock("./useIsMobile", () => ({ useIsMobile: () => true }));
    const { ResponsiveFilterBar: MobileBar } = await import("./ResponsiveFilterBar");

    const { container } = render(
      <MobileBar>
        <Select options={[]} />
        <Input />
      </MobileBar>
    );

    const space = container.querySelector(".ant-space");
    expect(space).toHaveClass("responsive-filter-bar--mobile");
    expect(space).toHaveClass("ant-space-vertical");
    vi.resetModules();
  });
});
