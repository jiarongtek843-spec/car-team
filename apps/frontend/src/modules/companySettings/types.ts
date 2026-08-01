export type CommissionType = "PERCENTAGE" | "FIXED_AMOUNT";

export interface CompanySettings {
  id: number;
  // General
  companyName: string;
  timezone: string;
  currency: string;
  // Booking
  defaultCommissionType: CommissionType;
  defaultCommissionValue: number;
  allowManualLegAllocation: boolean;
  requireDriverAccept: boolean;
  // Revenue Sharing（后端已有，UI 目前只在 Overview 页面用来标示比例，Company Settings
  // 页面本身没有编辑这两个栏位的表单——见 Round4 "移除Commission设定区块"）
  companyCommissionType: CommissionType;
  companyCommissionValue: number;
  // GPS
  gpsUploadIntervalSeconds: number;
  connectionLostTimeoutSeconds: number;
  offlineTimeoutSeconds: number;
  // Settlement
  defaultSettlementTime: string;
  settlementTimezone: string;
  // Collection
  collectionVerificationRequired: boolean;
  maxUploadFileSizeMb: number;
  updatedAt: string;
}

export type UpdateCompanySettingsInput = Partial<
  Omit<CompanySettings, "id" | "updatedAt">
>;
