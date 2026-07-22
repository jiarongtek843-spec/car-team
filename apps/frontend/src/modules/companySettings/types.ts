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
