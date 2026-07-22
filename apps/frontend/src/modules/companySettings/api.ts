import { http } from "../../api/http";
import type { CompanySettings, UpdateCompanySettingsInput } from "./types";

export function fetchCompanySettings() {
  return http.get<CompanySettings>("/api/admin/company-settings");
}

export function updateCompanySettings(input: UpdateCompanySettingsInput) {
  return http.patch<CompanySettings>("/api/admin/company-settings", input);
}
