import type { PermissionKey, RoleKey } from "../common/permissions";

export type DriverStatus = "ACTIVE" | "INACTIVE";

export interface AuthDriver {
  id: number;
  name: string;
  phone: string | null;
  vehiclePlateNumber: string | null;
  status: DriverStatus;
}

export interface AuthUser {
  id: number;
  username: string;
  role: { key: RoleKey; name: string };
  permissions: PermissionKey[];
  driver: AuthDriver | null;
}
