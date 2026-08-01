// 跟 apps/backend/src/common/permissions.ts 保持一致——Permission Key 是固定的字面量常数，
// 不是从后端动态抓来的，前端这份只是同一份定义的镜像（当前 monorepo 没有共用 packages，
// 之后如果要去重，可以搬进 packages/ 底下的共用类型档案）。

export const ROLE_KEYS = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  DISPATCHER: "DISPATCHER",
  DRIVER: "DRIVER",
  FINANCE: "FINANCE"
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export const PERMISSIONS = {
  BOOKING_READ: "booking:read",
  BOOKING_WRITE: "booking:write",
  DRIVER_READ: "driver:read",
  DRIVER_WRITE: "driver:write",
  DISPATCH_READ: "dispatch:read",
  GPS_READ: "gps:read",
  WALLET_READ: "wallet:read",
  WALLET_WRITE: "wallet:write",
  SETTLEMENT_READ: "settlement:read",
  SETTLEMENT_WRITE: "settlement:write",
  COLLECTION_READ: "collection:read",
  COLLECTION_WRITE: "collection:write",
  COMPANY_SETTINGS_READ: "companySettings:read",
  COMPANY_SETTINGS_WRITE: "companySettings:write",
  DRIVER_JOBS_SELF: "driverJobs:self",
  DRIVER_WALLET_SELF: "driverWallet:self",
  DRIVER_COLLECTION_SELF: "driverCollection:self",
  DRIVER_PRESENCE_SELF: "driverPresence:self",
  DRIVER_SETTLEMENT_SELF: "driverSettlement:self",
  NOTIFICATION_READ: "notification:read",
  NOTIFICATION_WRITE: "notification:write",
  DRIVER_NOTIFICATION_SELF: "driverNotification:self",
  REVENUE_SHARING_READ: "revenueSharing:read",
  REVENUE_SHARING_PREVIEW: "revenueSharing:preview",
  REVENUE_SHARING_FINALIZE: "revenueSharing:finalize"
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
