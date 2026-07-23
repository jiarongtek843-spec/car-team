import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponsiveModal } from "./ResponsiveModal";

describe("ResponsiveModal（桌面宽度渲染成置中 Modal，点确定会呼叫 onOk）", () => {
  it("桌面宽度渲染成 Modal，不是 Drawer", async () => {
    const onOk = vi.fn();

    render(
      <ResponsiveModal title="Test" open onCancel={() => {}} onOk={onOk} okText="确定">
        <div>内容</div>
      </ResponsiveModal>
    );

    expect(document.querySelector(".ant-modal")).not.toBeNull();
    expect(document.querySelector(".ant-drawer")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalled();
  });
});
