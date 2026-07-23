import { Grid } from "antd";

const { useBreakpoint } = Grid;

/**
 * Mobile Phase 1 的判断基准：antd 的 md 断点是 768px，小于这个宽度视为手机。
 * 用 antd 内建的 useBreakpoint，不额外引入 react-responsive 之类的套件。
 */
export function useIsMobile(): boolean {
  const screens = useBreakpoint();
  return !screens.md;
}
