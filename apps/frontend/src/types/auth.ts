export type UserRole = "ADMIN" | "DRIVER";
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
  role: UserRole;
  driver: AuthDriver | null;
}
