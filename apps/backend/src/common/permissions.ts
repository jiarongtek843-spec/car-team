// RBAC（Module 7）单一事实来源：Permission Key 固定写在这里（不是 DB 资料），
// Role 本身连同「哪个角色拥有哪些 Permission」才是存在数据库的资料（Role/RolePermission
// table）。这个档案里的 DEFAULT_ROLE_PERMISSIONS/DEFAULT_ROLES 只是「初始种子资料」，
// migration 套用之后，实际权限判断永远读数据库，不读这个常数——改数据库里的
// RolePermission 资料就能调整现有角色的权限，不需要重新部署程式码。
//
// 以后要新增角色（例如 Finance）：写一份新的 migration 插入一笔 Role + 对应的
// RolePermission，不需要改这个档案，也不需要改任何 router/controller/service。
// 只有在新增「全新的功能领域」（例如未来的 Module 8）才需要在这里补一个新的
// PERMISSIONS 常数，并在对应的 router 挂上 requirePermission(新 key)。

export const ROLE_KEYS = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  DISPATCHER: "DISPATCHER",
  DRIVER: "DRIVER"
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
  // Driver 自助：只能操作自己的资料，不是「管理其他 Driver」（那是 DRIVER_READ/WRITE）。
  DRIVER_JOBS_SELF: "driverJobs:self",
  DRIVER_WALLET_SELF: "driverWallet:self",
  DRIVER_COLLECTION_SELF: "driverCollection:self",
  DRIVER_PRESENCE_SELF: "driverPresence:self",
  DRIVER_SETTLEMENT_SELF: "driverSettlement:self"
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ADMIN_SIDE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.BOOKING_READ,
  PERMISSIONS.BOOKING_WRITE,
  PERMISSIONS.DRIVER_READ,
  PERMISSIONS.DRIVER_WRITE,
  PERMISSIONS.DISPATCH_READ,
  PERMISSIONS.GPS_READ,
  PERMISSIONS.WALLET_READ,
  PERMISSIONS.WALLET_WRITE,
  PERMISSIONS.SETTLEMENT_READ,
  PERMISSIONS.SETTLEMENT_WRITE,
  PERMISSIONS.COLLECTION_READ,
  PERMISSIONS.COLLECTION_WRITE,
  PERMISSIONS.COMPANY_SETTINGS_READ,
  PERMISSIONS.COMPANY_SETTINGS_WRITE
];

/**
 * 迁移/seed 用的初始角色→权限对照表，见 docs/modules/rbac.md 的权限矩阵。
 * Module 8 起，companySettings:read 开放给全部 4 个角色（只有 write 仍然是 OWNER only）——
 * Company Settings 的 General 分类（公司名称/时区/币别）跟 Driver 端要用到的 GPS 上传间隔
 * 之类的设定，Manager/Dispatcher/Driver 都需要能读到，只是不能改。
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  OWNER: ADMIN_SIDE_PERMISSIONS,
  MANAGER: ADMIN_SIDE_PERMISSIONS.filter((p) => p !== PERMISSIONS.COMPANY_SETTINGS_WRITE),
  DISPATCHER: [
    PERMISSIONS.BOOKING_READ,
    PERMISSIONS.BOOKING_WRITE,
    PERMISSIONS.DRIVER_READ,
    PERMISSIONS.DISPATCH_READ,
    PERMISSIONS.GPS_READ,
    PERMISSIONS.COMPANY_SETTINGS_READ
  ],
  DRIVER: [
    PERMISSIONS.DRIVER_JOBS_SELF,
    PERMISSIONS.DRIVER_WALLET_SELF,
    PERMISSIONS.DRIVER_COLLECTION_SELF,
    PERMISSIONS.DRIVER_PRESENCE_SELF,
    PERMISSIONS.DRIVER_SETTLEMENT_SELF,
    PERMISSIONS.COMPANY_SETTINGS_READ
  ]
};

export const DEFAULT_ROLES: { key: RoleKey; name: string; description: string }[] = [
  {
    key: ROLE_KEYS.OWNER,
    name: "Owner",
    description: "公司负责人，拥有所有权限，包含 Company Settings/Commission 设定。"
  },
  {
    key: ROLE_KEYS.MANAGER,
    name: "Manager",
    description: "日常车队营运：Booking、Driver、Dispatch、GPS、Wallet、Collection、Settlement，不含 Company Settings。"
  },
  {
    key: ROLE_KEYS.DISPATCHER,
    name: "Dispatcher",
    description: "派车专员：Booking、Dispatch Center、查看 Driver 与 GPS，不能碰 Wallet/Settlement/Collection/Commission。"
  },
  {
    key: ROLE_KEYS.DRIVER,
    name: "Driver",
    description: "司机，只能查看/操作自己的工作、GPS、收入、代收款、结算纪录。"
  }
];
