import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { useCompanySettingsQuery } from "./hooks";
import type { CompanySettings } from "./types";
import { setCurrencyPrefix } from "../../lib/money";

const CompanySettingsContext = createContext<CompanySettings | null>(null);

/**
 * 全站共用一份 Company Settings（币别显示、GPS 上传间隔等），只在登入之后才抓——
 * 未登入时没有 session，打这支 API 一定是 401。所有 4 个角色现在都有 companySettings:read
 * （见 docs/modules/rbac.md），所以 Driver Portal 也能正常拿到这份设定。
 */
export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data } = useCompanySettingsQuery({ enabled: !!user });

  useEffect(() => {
    if (data) {
      setCurrencyPrefix(data.currency);
    }
  }, [data]);

  return <CompanySettingsContext.Provider value={data ?? null}>{children}</CompanySettingsContext.Provider>;
}

/** 目前登入者能看到的 Company Settings；未登入或还在加载时是 null。 */
export function useCompanySettings() {
  return useContext(CompanySettingsContext);
}
