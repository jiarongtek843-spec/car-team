import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
// antd v5 官方还没正式支援 React 19（目前只到 18），cssinjs 底层用到的部分 React API
// 在 React 19 下行为变了，会导致 Drawer/Modal 这类靠 CSS transition 做进场动画的元件卡在
// 「关闭」的 transform 值不动（Mobile Phase 1 加的手机导览 Drawer 就是这样被发现的）。
// 这是 antd 官方发布、给 React 19 用的相容补丁，纯 side-effect import，不用另外呼叫任何函数。
import "@ant-design/v5-patch-for-react-19";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./modules/auth/AuthContext";
import { CompanySettingsProvider } from "./modules/companySettings/CompanySettingsContext";

const queryClient = new QueryClient();

// 只在 production build 注册——dev 模式下 Service Worker 的快取会跟 Vite HMR 打架
// （改完代码看到的还是快取过的旧版本），跟这个专案其他「只在 prod 生效」的开关同一个判准。
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不影响一般网页使用（例如 iOS Safari 私密浏览模式会挡 Service Worker），
      // 静默失败，退回「一般网页」的体验，不弹错误打断使用者。
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CompanySettingsProvider>
              <App />
            </CompanySettingsProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </StrictMode>
);
