import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponsiveModal } from "./ResponsiveModal";

// 拆成独立档案、用档案最顶层的 vi.mock（会被 hoist）固定 isMobile=true，
// 理由跟 DriverManagementPage.mobile.test.tsx 一样：ResponsiveModal 在这个
// 档案顶层已经被静态 import 一次，同一个档案内用 vi.doMock + 动态 import
// 切换情境并不可靠（拿到的可能还是同一个已快取的模组实例）。
vi.mock("./useIsMobile", () => ({ useIsMobile: () => true }));

describe("ResponsiveModal（手机宽度渲染成全屏 Drawer，点确定会呼叫 onOk）", () => {
  it("手机宽度渲染成 Drawer，不是 Modal", async () => {
    const onOk = vi.fn();

    render(
      <ResponsiveModal title="Test" open onCancel={() => {}} onOk={onOk} okText="确定">
        <div>内容</div>
      </ResponsiveModal>
    );

    expect(document.querySelector(".ant-drawer")).not.toBeNull();
    expect(document.querySelector(".ant-modal")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalled();
  });
});
