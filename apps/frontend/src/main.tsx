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
