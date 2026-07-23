import type { ReactNode } from "react";
import { Space } from "antd";
import { useIsMobile } from "./useIsMobile";

// Mobile UX + Scheduling Sprint：Collection / Dispatch Center / Driver List（Dispatch 指派
// 面板）/ Booking List 的 Search / Filter 各自手写了一份手机版逻辑，宽度、字体、按钮各写
// 各的，容易漏改也容易不一致——这个组件是唯一负责「filter 控件在手机上要怎么排」的地方，
// 各页面只要把既有的 Select/Input/Button 包进来，不需要再各自维护 isMobile 分支。
//
// 手机版：每个直接子元素独占一行（用 index.css 的 .responsive-filter-bar--mobile 规则
// 强制 width:100%，包含子元素自带的桌面用 inline width）。44px 触控高度、16px 字体已经是
// index.css 既有的全局手机规则，这里不用重复处理。
// 桌面版：维持原本紧凑横向 wrap，不影响既有桌面体验。
export function ResponsiveFilterBar({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <Space
      direction={isMobile ? "vertical" : "horizontal"}
      size={8}
      wrap={!isMobile}
      className={isMobile ? "responsive-filter-bar--mobile" : undefined}
      style={{ width: "100%", marginBottom: 16 }}
    >
      {children}
    </Space>
  );
}
