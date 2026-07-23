import "@testing-library/jest-dom/vitest";

// antd 的 Grid.useBreakpoint()（useIsMobile 底层）跟部分组件的响应式行为
// 会呼叫 window.matchMedia，jsdom 本身没有实作这个 API，不 mock 掉的话
// import antd 相关组件时会直接抛错，连测试都跑不起来。
//
// 关键：不能无脑回传 matches:false——如果每个 media query 永远不匹配，
// antd 的 useBreakpoint() 会判定「所有 breakpoint 都没匹配到」，
// useIsMobile()（= !screens.md）因此永远是 true，导致所有没有明确
// mock useIsMobile 的「桌面」测试也会被誤判成手机，渲染出 Drawer/Card
// 而不是预期的 Modal/Table。这里改成真的照 min-width 跟 jsdom 预设的
// window.innerWidth（1024，desktop 尺寸）去判断，「桌面」情境才会名副其实。
window.matchMedia = (query: string) => {
  const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
  const maxWidthMatch = query.match(/max-width:\s*(\d+)px/);
  const width = window.innerWidth || 1024;
  let matches = true;
  if (minWidthMatch) matches = matches && width >= Number(minWidthMatch[1]);
  if (maxWidthMatch) matches = matches && width <= Number(maxWidthMatch[1]);

  return {
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  } as unknown as MediaQueryList;
};

// antd 的 Select/Table 等组件用 ResizeObserver 量测容器尺寸，jsdom 同样没有实作。
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom 没有实作 scrollTo，antd Drawer/Modal 开启时有些内部逻辑会呼叫它。
if (!window.HTMLElement.prototype.scrollTo) {
  window.HTMLElement.prototype.scrollTo = () => {};
}
